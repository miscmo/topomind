export interface AuthenticatedUser {
  userId: string;
  email: string;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: string;
  updatedAt: string;
}
