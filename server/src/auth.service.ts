import { Injectable } from '@nestjs/common';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { PoolClient } from 'pg';

import { AppException } from './common/app-exception';
import { DatabaseService } from './database.service';
import type { UserSummary } from './auth.types';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  type?: 'access' | 'refresh';
}

interface LoginInput {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
}

interface RefreshInput {
  refreshToken?: unknown;
}

@Injectable()
export class AuthService {
  constructor(private readonly databaseService: DatabaseService) {}

  async login(input: LoginInput) {
    const email = normalizeEmail(input.email);
    const password = normalizePassword(input.password);
    const displayName = normalizeDisplayName(input.displayName, email);

    const existingUser = await this.findUserByEmail(email);

    if (!existingUser) {
      const user = await this.databaseService.withTransaction(async (client) => {
        const createdUser = await this.createUser(client, {
          email,
          displayName,
          password,
        });

        await this.createDefaultWorkspace(client, createdUser.id, createdUser.display_name);
        return createdUser;
      });

      return this.buildSession(user);
    }

    if (!verifyPassword(password, existingUser.password_hash)) {
      throw new AppException(401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    return this.buildSession(existingUser);
  }

  async refresh(input: RefreshInput) {
    const refreshToken = normalizeRefreshToken(input.refreshToken);
    const claims = await this.verifyToken(refreshToken, 'refresh');
    const user = await this.findUserById(claims.userId);

    if (!user) {
      throw new AppException(401, 'UNAUTHORIZED', 'User session is no longer valid');
    }

    return this.buildSession(user);
  }

  async getCurrentUser(userId: string): Promise<UserSummary> {
    const user = await this.findUserById(userId);

    if (!user) {
      throw new AppException(401, 'UNAUTHORIZED', 'User session is no longer valid');
    }

    return toUserSummary(user);
  }

  async verifyAccessToken(token: string): Promise<{ userId: string; email: string }> {
    return this.verifyToken(token, 'access');
  }

  private async buildSession(user: UserRow) {
    const userSummary = toUserSummary(user);
    const accessToken = await this.signToken(userSummary, 'access');
    const refreshToken = await this.signToken(userSummary, 'refresh');

    return {
      accessToken,
      refreshToken,
      user: userSummary,
    };
  }

  private async signToken(
    user: UserSummary,
    type: 'access' | 'refresh',
  ): Promise<string> {
    const secret = getSecret(type);
    const ttlSeconds = getTokenTtlSeconds(type);

    return new SignJWT({
      email: user.email,
      type,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(secret);
  }

  private async verifyToken(
    token: string,
    type: 'access' | 'refresh',
  ): Promise<{ userId: string; email: string }> {
    try {
      const { payload } = await jwtVerify<JwtPayload>(token, getSecret(type));

      if (payload.type !== type || !payload.sub || !payload.email) {
        throw new AppException(401, 'UNAUTHORIZED', 'Token payload is invalid');
      }

      return {
        userId: payload.sub,
        email: payload.email,
      };
    } catch {
      throw new AppException(401, 'UNAUTHORIZED', 'Token is invalid or expired');
    }
  }

  private async findUserByEmail(email: string): Promise<UserRow | null> {
    const result = await this.databaseService.query<UserRow>(
      `
        SELECT id, email, display_name, password_hash, created_at, updated_at
        FROM users
        WHERE email = $1
      `,
      [email],
    );

    return result.rows[0] ?? null;
  }

  private async findUserById(userId: string): Promise<UserRow | null> {
    const result = await this.databaseService.query<UserRow>(
      `
        SELECT id, email, display_name, password_hash, created_at, updated_at
        FROM users
        WHERE id = $1
      `,
      [userId],
    );

    return result.rows[0] ?? null;
  }

  private async createUser(
    client: PoolClient,
    input: { email: string; displayName: string; password: string },
  ): Promise<UserRow> {
    const result = await client.query<UserRow>(
      `
        INSERT INTO users (id, email, display_name, password_hash)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, display_name, password_hash, created_at, updated_at
      `,
      [randomUUID(), input.email, input.displayName, hashPassword(input.password)],
    );

    return result.rows[0];
  }

  private async createDefaultWorkspace(
    client: PoolClient,
    userId: string,
    displayName: string,
  ): Promise<void> {
    const workspaceId = randomUUID();
    const workspaceName = `${displayName} 的工作区`;

    await client.query(
      `
        INSERT INTO workspaces (id, owner_user_id, name)
        VALUES ($1, $2, $3)
      `,
      [workspaceId, userId, workspaceName],
    );

    await client.query(
      `
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES ($1, $2, 'owner')
      `,
      [workspaceId, userId],
    );
  }
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppException(422, 'VALIDATION_ERROR', 'Email is required');
  }

  const email = value.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    throw new AppException(422, 'VALIDATION_ERROR', 'Email format is invalid');
  }

  return email;
}

function normalizePassword(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppException(422, 'VALIDATION_ERROR', 'Password is required');
  }

  const password = value.trim();

  if (password.length < 6) {
    throw new AppException(
      422,
      'VALIDATION_ERROR',
      'Password must contain at least 6 characters',
    );
  }

  return password;
}

function normalizeDisplayName(value: unknown, email: string): string {
  if (typeof value === 'string') {
    const displayName = value.trim();

    if (displayName) {
      return displayName;
    }
  }

  return email.split('@')[0] || 'TopoMind User';
}

function normalizeRefreshToken(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppException(422, 'VALIDATION_ERROR', 'Refresh token is required');
  }

  return value.trim();
}

function hashPassword(password: string): string {
  const salt = randomUUID();
  const digest = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${digest}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedDigest] = storedHash.split(':');

  if (!salt || !expectedDigest) {
    return false;
  }

  const actualDigest = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(actualDigest), Buffer.from(expectedDigest));
}

function toUserSummary(user: UserRow): UserSummary {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
  };
}

function getSecret(type: 'access' | 'refresh'): Uint8Array {
  const envValue =
    type === 'access'
      ? process.env.JWT_ACCESS_SECRET
      : process.env.JWT_REFRESH_SECRET;

  const fallback =
    type === 'access'
      ? 'topomind-dev-access-secret'
      : 'topomind-dev-refresh-secret';

  return new TextEncoder().encode(envValue ?? fallback);
}

function getTokenTtlSeconds(type: 'access' | 'refresh'): number {
  const rawValue =
    type === 'access'
      ? process.env.ACCESS_TOKEN_TTL_SECONDS
      : process.env.REFRESH_TOKEN_TTL_SECONDS;

  const fallback = type === 'access' ? 3600 : 60 * 60 * 24 * 30;
  const parsedValue = Number(rawValue ?? fallback);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}
