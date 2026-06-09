import nodeFs from 'fs';
import nodePath from 'path';
import { createHash, randomUUID } from 'crypto';

export function createImportService(deps) {
  const {
    getCurrentWorkDir,
    localDbService,
    runSourceImport,
    planImportedAttachments = buildSourceImportAttachmentPlan,
    writeLog,
    wakeAttachmentUploadWorker = () => {},
  } = deps;

  if (!localDbService) {
    throw new Error('localDbService is required');
  }
  if (typeof getCurrentWorkDir !== 'function') {
    throw new Error('getCurrentWorkDir is required');
  }
  if (typeof runSourceImport !== 'function') {
    throw new Error('runSourceImport is required');
  }

  let processing = false;
  let activeStage = 'idle';
  let activeImportJobId = null;
  let lastError = '';

  function log(level, action, message, params) {
    if (typeof writeLog === 'function') {
      writeLog({
        level,
        module: 'ImportService',
        action,
        message,
        params,
      });
    }
  }

  function getReportsDir() {
    return nodePath.join(localDbService.getPaths().rootDir, 'import-reports');
  }

  function buildReportPath(importJobId) {
    const reportsDir = getReportsDir();
    nodeFs.mkdirSync(reportsDir, { recursive: true });
    return nodePath.join(reportsDir, `${importJobId}.json`);
  }

  function writeReport(reportPath, data) {
    nodeFs.mkdirSync(nodePath.dirname(reportPath), { recursive: true });
    nodeFs.writeFileSync(reportPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  function healthCheck() {
    return {
      ready: true,
      stage: processing ? activeStage : 'idle',
      supportedChannels: ['import:health', 'import:startImportJob', 'import:getImportJob'],
      currentImportJobId: activeImportJobId,
      processing,
      lastError,
    };
  }

  function getImportJob(importJobId) {
    return localDbService.getImportJob(importJobId);
  }

  function handleAttachmentUploadJobTerminalState(attachmentJob) {
    const uploadTicketJson = isRecord(attachmentJob?.uploadTicketJson) ? attachmentJob.uploadTicketJson : {};
    if (uploadTicketJson.source !== 'import:source_import_kb') {
      return null;
    }
    if (attachmentJob?.status !== 'done' && attachmentJob?.status !== 'failed' && attachmentJob?.status !== 'cancelled') {
      return null;
    }
    const importJobId =
      typeof uploadTicketJson.importJobId === 'string' && uploadTicketJson.importJobId.trim()
        ? uploadTicketJson.importJobId.trim()
        : null;
    if (!importJobId) {
      return null;
    }
    const importJob = localDbService.getImportJob(importJobId);
    if (!importJob || importJob.workspaceId !== attachmentJob.workspaceId) {
      return null;
    }

    const attachmentExecution = summarizeSourceImportAttachmentExecution({
      localDbService,
      workspaceId: importJob.workspaceId,
      importJobId,
    });
    const currentSummaryJson = isRecord(importJob.summaryJson) ? importJob.summaryJson : {};
    const nextSummaryJson = mergeSourceImportAttachmentExecutionSummary(
      currentSummaryJson,
      attachmentExecution,
    );
    const reportPath =
      typeof importJob.reportPath === 'string' && importJob.reportPath.trim()
        ? importJob.reportPath
        : typeof currentSummaryJson.reportPath === 'string' && currentSummaryJson.reportPath.trim()
          ? currentSummaryJson.reportPath
          : null;

    const report = readSourceImportReport(reportPath);
    const nextReport = {
      ...(isRecord(report) ? report : {}),
      attachmentExecution,
    };

    if (attachmentExecution.status === 'done') {
      const finishedAt = new Date().toISOString();
      const completedSummaryJson = {
        ...omitSourceImportFailureFields(nextSummaryJson),
        status: 'done',
        finishedAt,
        reportPath,
      };
      if (reportPath) {
        writeReport(reportPath, {
          ...nextReport,
          status: 'done',
          stage: 'report',
          finishedAt,
        });
      }
      localDbService.completeImportJob({
        importJobId,
        stage: 'report',
        summaryJson: completedSummaryJson,
        reportPath,
      });
      log('INFO', 'import:attachment-execution-update', '目录导入任务附件阶段已完成', {
        workspaceId: importJob.workspaceId,
        importJobId,
        attachmentJobId: attachmentJob.id,
        attachmentExecutionStatus: attachmentExecution.status,
        doneCount: attachmentExecution.summary.doneCount,
        failedCount: attachmentExecution.summary.failedCount,
      });
      return localDbService.getImportJob(importJobId);
    }

    if (attachmentExecution.status === 'failed') {
      const failedAt = new Date().toISOString();
      const failureMessage = buildSourceImportAttachmentExecutionFailureMessage(attachmentExecution);
      const failureSummaryJson = buildSourceImportFailureSummary(nextSummaryJson, {
        failedAt,
        error: failureMessage,
        stage: 'import-attachments',
        reportPath,
      });
      if (reportPath) {
        writeReport(reportPath, {
          ...nextReport,
          status: 'failed',
          stage: 'import-attachments',
          failedAt,
          summary: failureSummaryJson,
          error: failureMessage,
        });
      }
      localDbService.failImportJob({
        importJobId,
        stage: 'import-attachments',
        summaryJson: failureSummaryJson,
        reportPath,
      });
      log('ERROR', 'import:attachment-execution-update', '目录导入任务附件阶段失败', {
        workspaceId: importJob.workspaceId,
        importJobId,
        attachmentJobId: attachmentJob.id,
        attachmentExecutionStatus: attachmentExecution.status,
        doneCount: attachmentExecution.summary.doneCount,
        failedCount: attachmentExecution.summary.failedCount,
        error: failureMessage,
      });
      return localDbService.getImportJob(importJobId);
    }

    if (reportPath) {
      writeReport(reportPath, {
        ...nextReport,
        status: 'running',
        stage: 'import-attachments',
      });
    }

    localDbService.updateImportJobProgress({
      importJobId,
      stage: 'import-attachments',
      summaryJson: nextSummaryJson,
      reportPath,
    });

    log('INFO', 'import:attachment-execution-update', '目录导入任务已回写附件执行结果', {
      workspaceId: importJob.workspaceId,
      importJobId,
      attachmentJobId: attachmentJob.id,
      attachmentExecutionStatus: attachmentExecution.status,
      doneCount: attachmentExecution.summary.doneCount,
      failedCount: attachmentExecution.summary.failedCount,
    });

    return localDbService.getImportJob(importJobId);
  }

  function startImportJob(input) {
    const normalized = normalizeStartImportJobInput(input);
    const job = localDbService.createImportJob({
      workspaceId: normalized.workspaceId,
      sourcePath: normalized.sourcePath,
      stage: 'source-import',
      summaryJson: {
        mode: 'source_import_kb',
        requestedAt: new Date().toISOString(),
        sourcePath: normalized.sourcePath,
      },
    });

    log('INFO', 'import:startImportJob', '已创建目录导入任务', {
      workspaceId: normalized.workspaceId,
      importJobId: job.id,
      sourcePath: normalized.sourcePath,
    });

    void processPendingJobs();
    return job;
  }

  async function processPendingJobs() {
    if (processing) {
      return;
    }

    processing = true;
    lastError = '';

    try {
      while (true) {
        const job = localDbService.claimNextPendingImportJob();
        if (!job) {
          activeStage = 'idle';
          activeImportJobId = null;
          return;
        }

        activeStage = job.stage || 'source-import';
        activeImportJobId = job.id;

        const reportPath = buildReportPath(job.id);
        const workDir = getCurrentWorkDir();
        if (typeof workDir !== 'string' || !workDir.trim()) {
          throw new Error('尚未进入工作目录');
        }

        log('INFO', 'import:stage-change', '目录导入任务开始执行', {
          workspaceId: job.workspaceId,
          importJobId: job.id,
          sourcePath: job.sourcePath,
          stage: activeStage,
        });

        let currentSummaryJson = isRecord(job.summaryJson) ? job.summaryJson : {};
        let startedAt =
          typeof currentSummaryJson.startedAt === 'string' && currentSummaryJson.startedAt.trim()
            ? currentSummaryJson.startedAt.trim()
            : new Date().toISOString();
        try {
          const checkpoint = getSourceImportCheckpoint(job);
          let importedKbPath = checkpoint.importedKbPath;
          if (importedKbPath) {
            log('INFO', 'import:resume-from-checkpoint', '目录导入任务复用本地 checkpoint', {
              workspaceId: job.workspaceId,
              importJobId: job.id,
              sourcePath: job.sourcePath,
              importedKbPath,
            });
          } else {
            importedKbPath = await Promise.resolve(runSourceImport(workDir, job.sourcePath));
            const entityMapping = buildSourceImportEntityMapping(importedKbPath, currentSummaryJson);
            currentSummaryJson = buildSourceImportImportCheckpointSummary({
              requestedAt: job.summaryJson?.requestedAt,
              sourcePath: job.sourcePath,
              importedKbPath,
              startedAt,
              entityMapping,
            });
            localDbService.updateImportJobProgress({
              importJobId: job.id,
              stage: 'source-import',
              summaryJson: currentSummaryJson,
              reportPath,
            });
          }

          const executionCheckpoint = readSourceImportExecutionCheckpoint({
            summaryJson: currentSummaryJson,
            reportPath,
          });

          let entityMapping = executionCheckpoint.entityMapping;
          let attachmentPlan = executionCheckpoint.attachmentPlan;
          let scanCompletedAt = executionCheckpoint.scanCompletedAt;
          let structureImport = executionCheckpoint.structureImport;
          let structureCompletedAt = executionCheckpoint.structureCompletedAt;

          if (!hasSourceImportExecutionAttachmentPlan(attachmentPlan, entityMapping)) {
            activeStage = 'scan';
            let nextEntityMapping = buildSourceImportEntityMapping(importedKbPath, currentSummaryJson);
            const rawAttachmentPlan = await Promise.resolve(planImportedAttachments(importedKbPath, job));
            nextEntityMapping = extendSourceImportEntityMappingWithAttachmentPlan(
              nextEntityMapping,
              rawAttachmentPlan,
            );
            attachmentPlan = decorateAttachmentPlanWithEntityMapping(
              rawAttachmentPlan,
              nextEntityMapping,
            );
            entityMapping = nextEntityMapping;
            scanCompletedAt = new Date().toISOString();
            currentSummaryJson = buildSourceImportSummary({
              requestedAt: job.summaryJson?.requestedAt,
              sourcePath: job.sourcePath,
              importedKbPath,
              startedAt,
              attachmentPlan,
              scanCompletedAt,
              entityMapping,
            });
            writeReport(reportPath, {
              mode: 'source_import_kb',
              workspaceId: job.workspaceId,
              importJobId: job.id,
              sourcePath: job.sourcePath,
              importedKbPath,
              startedAt,
              scanCompletedAt,
              status: 'running',
              stage: 'scan',
              entityMapping,
              attachmentPlan,
            });
            localDbService.updateImportJobProgress({
              importJobId: job.id,
              stage: 'scan',
              summaryJson: currentSummaryJson,
              reportPath,
            });
          }

          const planningReport = {
            mode: 'source_import_kb',
            workspaceId: job.workspaceId,
            importJobId: job.id,
            sourcePath: job.sourcePath,
            importedKbPath,
            startedAt,
            scanCompletedAt,
            status: 'running',
            stage: 'scan',
            entityMapping,
            attachmentPlan,
          };

          if (!hasSourceImportExecutionStructureImport(structureImport)) {
            activeStage = 'import-structure';
            structureImport = materializeSourceImportStructure({
              localDbService,
              workspaceId: job.workspaceId,
              importedKbPath,
              entityMapping,
            });
            structureCompletedAt = new Date().toISOString();
            currentSummaryJson = buildSourceImportSummary({
              requestedAt: job.summaryJson?.requestedAt,
              sourcePath: job.sourcePath,
              importedKbPath,
              startedAt,
              attachmentPlan,
              scanCompletedAt,
              entityMapping,
              structureImport,
              structureCompletedAt,
            });
            writeReport(reportPath, {
              ...planningReport,
              status: 'running',
              stage: 'import-structure',
              structureCompletedAt,
              structureImport,
            });
            localDbService.updateImportJobProgress({
              importJobId: job.id,
              stage: 'import-structure',
              summaryJson: currentSummaryJson,
              reportPath,
            });
          }

          const importingReport = {
            ...planningReport,
            status: 'running',
            stage: 'import-structure',
            structureCompletedAt,
            structureImport,
          };

          activeStage = 'push';
          const structurePush = getSourceImportStructurePushState({
            localDbService,
            workspaceId: job.workspaceId,
            structureImport,
          });
          if (structurePush.summary.failedCount > 0 || structurePush.summary.conflictedCount > 0) {
            throw new Error(
              buildSourceImportStructurePushBlockingMessage(structurePush.summary),
            );
          }

          if (structurePush.summary.pendingCount > 0 || structurePush.summary.sendingCount > 0) {
            currentSummaryJson = buildSourceImportSummary({
              requestedAt: job.summaryJson?.requestedAt,
              sourcePath: job.sourcePath,
              importedKbPath,
              startedAt,
              attachmentPlan,
              scanCompletedAt,
              entityMapping,
              structureImport,
              structureCompletedAt,
              structurePush,
            });
            const waitingReport = {
              ...importingReport,
              status: 'waiting',
              stage: 'push',
              structurePush,
            };
            writeReport(reportPath, waitingReport);
            localDbService.requeueImportJob({
              importJobId: job.id,
              stage: 'push',
              summaryJson: currentSummaryJson,
              reportPath,
            });
            log('INFO', 'import:stage-change', '目录导入任务等待结构同步完成后继续附件导入', {
              workspaceId: job.workspaceId,
              importJobId: job.id,
              pendingOwnerOutboxCount: structurePush.summary.pendingCount,
              sendingOwnerOutboxCount: structurePush.summary.sendingCount,
            });
            activeImportJobId = null;
            activeStage = 'idle';
            return;
          }

          activeStage = 'import-attachments';
          currentSummaryJson = buildSourceImportSummary({
            requestedAt: job.summaryJson?.requestedAt,
            sourcePath: job.sourcePath,
            importedKbPath,
            startedAt,
            attachmentPlan,
            scanCompletedAt,
            entityMapping,
            structureImport,
            structureCompletedAt,
            structurePush,
          });
          const attachmentImportingReport = {
            ...importingReport,
            status: 'running',
            stage: 'import-attachments',
            structurePush,
          };
          writeReport(reportPath, attachmentImportingReport);
          localDbService.updateImportJobProgress({
            importJobId: job.id,
            stage: 'import-attachments',
            summaryJson: currentSummaryJson,
            reportPath,
          });

          const attachmentImport = enqueueSourceImportAttachmentJobs({
            importJobId: job.id,
            workspaceId: job.workspaceId,
            importedKbPath,
            attachmentPlan,
            localDbService,
          });
          const attachmentExecution = summarizeSourceImportAttachmentExecution({
            localDbService,
            workspaceId: job.workspaceId,
            importJobId: job.id,
          });
          const attachmentImportCompletedAt = new Date().toISOString();
          currentSummaryJson = buildSourceImportSummary({
            requestedAt: job.summaryJson?.requestedAt,
            sourcePath: job.sourcePath,
            importedKbPath,
            startedAt,
            attachmentPlan,
            scanCompletedAt,
            entityMapping,
            structureImport,
            structureCompletedAt,
            structurePush,
            attachmentImport,
            attachmentExecution,
            attachmentImportCompletedAt,
          });
          const attachmentExecutionReport = {
            ...attachmentImportingReport,
            status: 'running',
            stage: 'import-attachments',
            structurePush,
            attachmentImportCompletedAt,
            attachmentImport,
            attachmentExecution,
          };
          writeReport(reportPath, attachmentExecutionReport);

          if (attachmentImport.summary.totalCount > 0) {
            localDbService.updateImportJobProgress({
              importJobId: job.id,
              stage: 'import-attachments',
              summaryJson: currentSummaryJson,
              reportPath,
            });
            void Promise.resolve(wakeAttachmentUploadWorker());
            log(
              'INFO',
              'import:stage-change',
              '目录导入任务已创建附件上传任务，等待附件 worker 回写执行结果',
              {
                workspaceId: job.workspaceId,
                importJobId: job.id,
                plannedAttachmentCount: attachmentPlan.summary.totalCount,
                queuedAttachmentUploadJobCount: attachmentImport.summary.createdCount,
              },
            );
            continue;
          }

          const finishedAt = new Date().toISOString();
          const report = {
            ...attachmentExecutionReport,
            status: 'done',
            stage: 'report',
            finishedAt,
          };
          writeReport(reportPath, report);
          localDbService.completeImportJob({
            importJobId: job.id,
            stage: 'report',
            summaryJson: {
              ...currentSummaryJson,
              status: 'done',
              finishedAt,
              reportPath,
            },
            reportPath,
          });

          log('INFO', 'import:stage-change', '目录导入任务已完成', {
            workspaceId: job.workspaceId,
            importJobId: job.id,
            sourcePath: job.sourcePath,
            importedKbPath,
            plannedAttachmentCount: attachmentPlan.summary.totalCount,
            importedCardCount: structureImport.summary.cardCreatedCount,
            queuedAttachmentUploadJobCount: attachmentImport.summary.createdCount,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failedAt = new Date().toISOString();
          const failureSummaryJson = buildSourceImportFailureSummary(currentSummaryJson, {
            failedAt,
            error: message,
            stage: activeStage,
            reportPath,
          });
          const previousReport = readSourceImportReport(reportPath);
          const report = {
            ...(isRecord(previousReport) ? previousReport : {}),
            mode: 'source_import_kb',
            workspaceId: job.workspaceId,
            importJobId: job.id,
            sourcePath: job.sourcePath,
            startedAt,
            failedAt,
            stage: activeStage,
            status: 'failed',
            summary: failureSummaryJson,
            error: message,
          };
          writeReport(reportPath, report);
          localDbService.failImportJob({
            importJobId: job.id,
            stage: activeStage,
            summaryJson: failureSummaryJson,
            reportPath,
          });
          lastError = message;

          log('ERROR', 'import:stage-change', '目录导入任务执行失败', {
            workspaceId: job.workspaceId,
            importJobId: job.id,
            sourcePath: job.sourcePath,
            error: message,
          });
        }
      }
    } finally {
      processing = false;
      if (!activeImportJobId) {
        activeStage = 'idle';
      }
    }
  }

  return {
    healthCheck,
    getImportJob,
    startImportJob,
    processPendingJobs,
    handleAttachmentUploadJobTerminalState,
  };
}

function buildSourceImportSummary(input) {
  const attachmentPlanSummary = isRecord(input?.attachmentPlan?.summary)
    ? input.attachmentPlan.summary
    : {};
  const entityMappingSummary = isRecord(input?.entityMapping?.summary)
    ? input.entityMapping.summary
    : {};
  const structureImportSummary = isRecord(input?.structureImport?.summary)
    ? input.structureImport.summary
    : {};
  const structurePushSummary = isRecord(input?.structurePush?.summary)
    ? input.structurePush.summary
    : {};
  const attachmentImportSummary = isRecord(input?.attachmentImport?.summary)
    ? input.attachmentImport.summary
    : {};
  const attachmentExecutionSummary = isRecord(input?.attachmentExecution?.summary)
    ? input.attachmentExecution.summary
    : {};

  return {
    mode: 'source_import_kb',
    requestedAt: typeof input?.requestedAt === 'string' ? input.requestedAt : null,
    sourcePath: input.sourcePath,
    importedKbPath: input.importedKbPath,
    startedAt: input.startedAt,
    scanCompletedAt: input.scanCompletedAt,
    structureCompletedAt:
      typeof input?.structureCompletedAt === 'string' ? input.structureCompletedAt : null,
    attachmentImportCompletedAt:
      typeof input?.attachmentImportCompletedAt === 'string'
        ? input.attachmentImportCompletedAt
        : null,
    sourceImport: {
      status: input?.importedKbPath ? 'done' : 'pending',
      importedKbPath: input.importedKbPath,
    },
    entityMapping: {
      status: 'planned',
      knowledgeBaseId:
        typeof input?.entityMapping?.knowledgeBaseId === 'string'
          ? input.entityMapping.knowledgeBaseId
          : null,
      cardCount: toFiniteNumber(entityMappingSummary.cardCount),
      reusedLegacyIdCount: toFiniteNumber(entityMappingSummary.reusedLegacyIdCount),
      generatedIdCount: toFiniteNumber(entityMappingSummary.generatedIdCount),
      reportIncludesItems: true,
      itemsByLegacyPath: isRecord(input?.entityMapping?.itemsByLegacyPath)
        ? input.entityMapping.itemsByLegacyPath
        : {},
    },
    attachmentPlanning: {
      status: 'planned',
      totalCount: toFiniteNumber(attachmentPlanSummary.totalCount),
      totalBytes: toFiniteNumber(attachmentPlanSummary.totalBytes),
      cardAttachmentCount: toFiniteNumber(attachmentPlanSummary.cardAttachmentCount),
      knowledgeBaseAttachmentCount: toFiniteNumber(attachmentPlanSummary.knowledgeBaseAttachmentCount),
      resolvedOwnerCount: toFiniteNumber(attachmentPlanSummary.resolvedOwnerCount),
      unresolvedOwnerCount: toFiniteNumber(attachmentPlanSummary.unresolvedOwnerCount),
      warningCount: Array.isArray(input?.attachmentPlan?.warnings)
        ? input.attachmentPlan.warnings.length
        : 0,
      reportIncludesItems: true,
    },
    structureImport: {
      status:
        typeof input?.structureImport?.status === 'string' ? input.structureImport.status : 'pending',
      knowledgeBaseId:
        typeof input?.structureImport?.knowledgeBaseId === 'string'
          ? input.structureImport.knowledgeBaseId
          : typeof input?.entityMapping?.knowledgeBaseId === 'string'
            ? input.entityMapping.knowledgeBaseId
            : null,
      knowledgeBaseCreatedCount: toFiniteNumber(structureImportSummary.knowledgeBaseCreatedCount),
      knowledgeBaseReusedCount: toFiniteNumber(structureImportSummary.knowledgeBaseReusedCount),
      cardCreatedCount: toFiniteNumber(structureImportSummary.cardCreatedCount),
      cardReusedCount: toFiniteNumber(structureImportSummary.cardReusedCount),
      totalCardCount: toFiniteNumber(structureImportSummary.totalCardCount),
      reportIncludesItems: Boolean(input?.structureImport),
    },
    structurePush: {
      status:
        typeof input?.structurePush?.status === 'string' ? input.structurePush.status : 'pending',
      pendingCount: toFiniteNumber(structurePushSummary.pendingCount),
      sendingCount: toFiniteNumber(structurePushSummary.sendingCount),
      failedCount: toFiniteNumber(structurePushSummary.failedCount),
      conflictedCount: toFiniteNumber(structurePushSummary.conflictedCount),
      cleanCount: toFiniteNumber(structurePushSummary.cleanCount),
      totalCount: toFiniteNumber(structurePushSummary.totalCount),
      reportIncludesItems: Boolean(input?.structurePush),
    },
    attachmentImport: {
      status:
        typeof input?.attachmentImport?.status === 'string' ? input.attachmentImport.status : 'pending',
      totalCount: toFiniteNumber(attachmentImportSummary.totalCount),
      createdCount: toFiniteNumber(attachmentImportSummary.createdCount),
      reusedCount: toFiniteNumber(attachmentImportSummary.reusedCount),
      knowledgeBaseAttachmentCount: toFiniteNumber(
        attachmentImportSummary.knowledgeBaseAttachmentCount,
      ),
      cardAttachmentCount: toFiniteNumber(attachmentImportSummary.cardAttachmentCount),
      reportIncludesItems: Boolean(input?.attachmentImport),
    },
    attachmentExecution: {
      status:
        typeof input?.attachmentExecution?.status === 'string'
          ? input.attachmentExecution.status
          : 'pending',
      totalCount: toFiniteNumber(attachmentExecutionSummary.totalCount),
      pendingCount: toFiniteNumber(attachmentExecutionSummary.pendingCount),
      uploadingCount: toFiniteNumber(attachmentExecutionSummary.uploadingCount),
      uploadedCount: toFiniteNumber(attachmentExecutionSummary.uploadedCount),
      committingCount: toFiniteNumber(attachmentExecutionSummary.committingCount),
      doneCount: toFiniteNumber(attachmentExecutionSummary.doneCount),
      failedCount: toFiniteNumber(attachmentExecutionSummary.failedCount),
      cancelledCount: toFiniteNumber(attachmentExecutionSummary.cancelledCount),
      reportIncludesItems: Boolean(input?.attachmentExecution),
    },
  };
}

function buildSourceImportImportCheckpointSummary(input) {
  return {
    mode: 'source_import_kb',
    requestedAt: typeof input?.requestedAt === 'string' ? input.requestedAt : null,
    sourcePath: input.sourcePath,
    importedKbPath: input.importedKbPath,
    startedAt: input.startedAt,
    sourceImport: {
      status: 'done',
      importedKbPath: input.importedKbPath,
    },
    entityMapping: {
      status: 'planned',
      knowledgeBaseId:
        typeof input?.entityMapping?.knowledgeBaseId === 'string'
          ? input.entityMapping.knowledgeBaseId
          : null,
      cardCount: toFiniteNumber(input?.entityMapping?.summary?.cardCount),
      reusedLegacyIdCount: toFiniteNumber(input?.entityMapping?.summary?.reusedLegacyIdCount),
      generatedIdCount: toFiniteNumber(input?.entityMapping?.summary?.generatedIdCount),
      reportIncludesItems: true,
      itemsByLegacyPath: isRecord(input?.entityMapping?.itemsByLegacyPath)
        ? input.entityMapping.itemsByLegacyPath
        : {},
    },
  };
}

function buildSourceImportFailureSummary(previousSummaryJson, input) {
  const previous = isRecord(previousSummaryJson) ? previousSummaryJson : {};
  return {
    ...previous,
    status: 'failed',
    failedAt: input.failedAt,
    error: input.error,
    failedStage: input.stage,
    reportPath: input.reportPath,
  };
}

function mergeSourceImportAttachmentExecutionSummary(previousSummaryJson, attachmentExecution) {
  const previous = isRecord(previousSummaryJson) ? previousSummaryJson : {};
  const executionSummary = isRecord(attachmentExecution?.summary) ? attachmentExecution.summary : {};
  return {
    ...previous,
    attachmentExecution: {
      status:
        typeof attachmentExecution?.status === 'string' ? attachmentExecution.status : 'pending',
      totalCount: toFiniteNumber(executionSummary.totalCount),
      pendingCount: toFiniteNumber(executionSummary.pendingCount),
      uploadingCount: toFiniteNumber(executionSummary.uploadingCount),
      uploadedCount: toFiniteNumber(executionSummary.uploadedCount),
      committingCount: toFiniteNumber(executionSummary.committingCount),
      doneCount: toFiniteNumber(executionSummary.doneCount),
      failedCount: toFiniteNumber(executionSummary.failedCount),
      cancelledCount: toFiniteNumber(executionSummary.cancelledCount),
      reportIncludesItems: Boolean(attachmentExecution),
    },
  };
}

function omitSourceImportFailureFields(summaryJson) {
  const nextSummaryJson = isRecord(summaryJson) ? { ...summaryJson } : {};
  delete nextSummaryJson.failedAt;
  delete nextSummaryJson.error;
  delete nextSummaryJson.failedStage;
  return nextSummaryJson;
}

function readSourceImportExecutionCheckpoint(input) {
  const summaryJson = isRecord(input?.summaryJson) ? input.summaryJson : {};
  const report = readSourceImportReport(input?.reportPath);
  return {
    entityMapping: isRecord(report?.entityMapping) ? report.entityMapping : null,
    attachmentPlan: isRecord(report?.attachmentPlan) ? report.attachmentPlan : null,
    structureImport: isRecord(report?.structureImport) ? report.structureImport : null,
    scanCompletedAt:
      typeof report?.scanCompletedAt === 'string' && report.scanCompletedAt.trim()
        ? report.scanCompletedAt.trim()
        : typeof summaryJson.scanCompletedAt === 'string' && summaryJson.scanCompletedAt.trim()
          ? summaryJson.scanCompletedAt.trim()
          : null,
    structureCompletedAt:
      typeof report?.structureCompletedAt === 'string' && report.structureCompletedAt.trim()
        ? report.structureCompletedAt.trim()
        : typeof summaryJson.structureCompletedAt === 'string' && summaryJson.structureCompletedAt.trim()
          ? summaryJson.structureCompletedAt.trim()
          : null,
  };
}

function readSourceImportReport(reportPath) {
  if (typeof reportPath !== 'string' || !reportPath.trim()) {
    return null;
  }
  try {
    if (!nodeFs.existsSync(reportPath) || !nodeFs.statSync(reportPath).isFile()) {
      return null;
    }
    const content = nodeFs.readFileSync(reportPath, 'utf-8');
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasSourceImportExecutionAttachmentPlan(attachmentPlan, entityMapping) {
  return (
    isRecord(attachmentPlan) &&
    Array.isArray(attachmentPlan.items) &&
    isRecord(entityMapping) &&
    typeof entityMapping.knowledgeBaseId === 'string' &&
    isRecord(entityMapping.itemsByLegacyPath)
  );
}

function hasSourceImportExecutionStructureImport(structureImport) {
  return isRecord(structureImport) && Array.isArray(structureImport.items);
}

function summarizeSourceImportAttachmentExecution(input) {
  const localDbService = input?.localDbService;
  if (!localDbService || typeof localDbService.listImportAttachmentUploadJobs !== 'function') {
    throw new Error('localDbService.listImportAttachmentUploadJobs is required');
  }
  const workspaceId = normalizeNonEmptyString(input?.workspaceId, 'workspaceId');
  const importJobId = normalizeNonEmptyString(input?.importJobId, 'importJobId');
  const jobs = localDbService.listImportAttachmentUploadJobs({
    workspaceId,
    importJobId,
  });
  const summary = {
    totalCount: jobs.length,
    pendingCount: 0,
    uploadingCount: 0,
    uploadedCount: 0,
    committingCount: 0,
    doneCount: 0,
    failedCount: 0,
    cancelledCount: 0,
  };

  const items = jobs.map((job) => {
    const status = typeof job?.status === 'string' ? job.status : 'pending';
    if (status === 'pending') summary.pendingCount += 1;
    else if (status === 'uploading') summary.uploadingCount += 1;
    else if (status === 'uploaded') summary.uploadedCount += 1;
    else if (status === 'committing') summary.committingCount += 1;
    else if (status === 'done') summary.doneCount += 1;
    else if (status === 'failed') summary.failedCount += 1;
    else if (status === 'cancelled') summary.cancelledCount += 1;
    return {
      attachmentJobId: job.id,
      status,
      fileName: job.fileName,
      relativePath:
        typeof job?.uploadTicketJson?.relativePath === 'string' ? job.uploadTicketJson.relativePath : null,
      ownerScope:
        typeof job?.uploadTicketJson?.ownerScope === 'string' ? job.uploadTicketJson.ownerScope : null,
      ownerCardPath:
        typeof job?.uploadTicketJson?.ownerCardPath === 'string'
          ? job.uploadTicketJson.ownerCardPath
          : null,
      storageKey: typeof job?.storageKey === 'string' ? job.storageKey : null,
      lastErrorCode: typeof job?.lastErrorCode === 'string' ? job.lastErrorCode : null,
      lastErrorMessage:
        typeof job?.lastErrorMessage === 'string' ? job.lastErrorMessage : null,
      updatedAt: typeof job?.updatedAt === 'string' ? job.updatedAt : null,
    };
  });

  return {
    status:
      summary.totalCount === 0
        ? 'done'
        : summary.failedCount > 0 || summary.cancelledCount > 0
          ? 'failed'
          : summary.doneCount === summary.totalCount
            ? 'done'
            : 'running',
    items,
    summary,
  };
}

function buildSourceImportAttachmentExecutionFailureMessage(attachmentExecution) {
  const summary = isRecord(attachmentExecution?.summary) ? attachmentExecution.summary : {};
  const failedCount = toFiniteNumber(summary.failedCount);
  const cancelledCount = toFiniteNumber(summary.cancelledCount);
  const sampleFailedItem = Array.isArray(attachmentExecution?.items)
    ? attachmentExecution.items.find(
        (item) =>
          isRecord(item)
          && (item.status === 'failed' || item.status === 'cancelled')
          && typeof item.lastErrorMessage === 'string'
          && item.lastErrorMessage.trim(),
      )
    : null;
  const parts = [];
  if (failedCount > 0) {
    parts.push(`failed=${failedCount}`);
  }
  if (cancelledCount > 0) {
    parts.push(`cancelled=${cancelledCount}`);
  }
  const detail =
    sampleFailedItem && typeof sampleFailedItem.lastErrorMessage === 'string'
      ? `: ${sampleFailedItem.lastErrorMessage.trim()}`
      : '';
  return `目录导入附件上传失败 (${parts.join(', ') || 'unknown'})${detail}`;
}

function getSourceImportStructurePushState(input) {
  const localDbService = input?.localDbService;
  if (!localDbService || typeof localDbService.getImportStructureOutboxState !== 'function') {
    throw new Error('localDbService.getImportStructureOutboxState is required');
  }
  const structureItems = Array.isArray(input?.structureImport?.items) ? input.structureImport.items : [];
  const entityRefs = structureItems
    .filter((item) => isRecord(item) && isImportStructureEntityType(item.entityType))
    .map((item) => ({
      entityType: item.entityType,
      entityId: normalizeNonEmptyString(item.plannedId, `structureImport.${item.entityType}.plannedId`),
    }));
  if (entityRefs.length === 0) {
    return {
      status: 'clean',
      items: [],
      summary: {
        totalCount: 0,
        cleanCount: 0,
        pendingCount: 0,
        sendingCount: 0,
        failedCount: 0,
        conflictedCount: 0,
      },
    };
  }

  const outboxState = localDbService.getImportStructureOutboxState({
    workspaceId: normalizeNonEmptyString(input.workspaceId, 'workspaceId'),
    entityRefs,
  });
  return {
    status:
      outboxState.summary.failedCount > 0 || outboxState.summary.conflictedCount > 0
        ? 'blocked'
        : outboxState.summary.pendingCount > 0 || outboxState.summary.sendingCount > 0
          ? 'waiting'
          : 'clean',
    items: outboxState.items,
    summary: outboxState.summary,
  };
}

function buildSourceImportStructurePushBlockingMessage(summary) {
  const parts = [];
  if (toFiniteNumber(summary.failedCount) > 0) {
    parts.push(`failed=${toFiniteNumber(summary.failedCount)}`);
  }
  if (toFiniteNumber(summary.conflictedCount) > 0) {
    parts.push(`conflicted=${toFiniteNumber(summary.conflictedCount)}`);
  }
  return `导入结构对应的同步 outbox 尚未完成，请先处理后再恢复导入任务 (${parts.join(', ')})`;
}

function enqueueSourceImportAttachmentJobs(input) {
  const localDbService = input?.localDbService;
  if (!localDbService || typeof localDbService.createAttachmentUploadJob !== 'function') {
    throw new Error('localDbService.createAttachmentUploadJob is required');
  }
  if (typeof localDbService.getAttachmentUploadJob !== 'function') {
    throw new Error('localDbService.getAttachmentUploadJob is required');
  }

  const importJobId = normalizeNonEmptyString(input.importJobId, 'importJobId');
  const workspaceId = normalizeNonEmptyString(input.workspaceId, 'workspaceId');
  const importedKbPath = normalizeNonEmptyString(input.importedKbPath, 'importedKbPath');
  const items = Array.isArray(input?.attachmentPlan?.items) ? input.attachmentPlan.items : [];
  const attachmentItems = [];
  let createdCount = 0;
  let reusedCount = 0;
  let knowledgeBaseAttachmentCount = 0;
  let cardAttachmentCount = 0;

  for (const item of items) {
    const normalizedItem = normalizeSourceImportAttachmentPlanItem(item);
    const attachmentJobId = buildSourceImportAttachmentJobId(importJobId, normalizedItem.relativePath);
    const existingJob = localDbService.getAttachmentUploadJob(attachmentJobId);
    if (normalizedItem.ownerScope === 'knowledge_base') {
      knowledgeBaseAttachmentCount += 1;
    } else {
      cardAttachmentCount += 1;
    }

    if (!existingJob) {
      localDbService.createAttachmentUploadJob({
        attachmentJobId,
        workspaceId,
        localFilePath: normalizedItem.localFilePath,
        knowledgeBaseId:
          normalizedItem.ownerScope === 'knowledge_base' ? normalizedItem.plannedKnowledgeBaseId : null,
        cardId: normalizedItem.ownerScope === 'card' ? normalizedItem.plannedCardId : null,
        documentId: null,
        fileName: normalizedItem.fileName,
        mimeType: normalizedItem.mimeType,
        sizeBytes: normalizedItem.sizeBytes,
        uploadTicketJson: {
          source: 'import:source_import_kb',
          mode: 'import_attachment_pending_upload',
          importJobId,
          importedKbPath,
          relativePath: normalizedItem.relativePath,
          attachmentRef: normalizedItem.attachmentRef,
          ownerScope: normalizedItem.ownerScope,
          ownerCardPath: normalizedItem.ownerCardPath,
        },
        storageKey: null,
        sha256: null,
      });
      createdCount += 1;
    } else {
      reusedCount += 1;
    }

    attachmentItems.push({
      attachmentJobId,
      relativePath: normalizedItem.relativePath,
      ownerScope: normalizedItem.ownerScope,
      ownerCardPath: normalizedItem.ownerCardPath,
      plannedKnowledgeBaseId: normalizedItem.plannedKnowledgeBaseId,
      plannedCardId: normalizedItem.plannedCardId,
      action: existingJob ? 'existing' : 'created',
    });
  }

  return {
    status: 'enqueued',
    items: attachmentItems,
    summary: {
      totalCount: items.length,
      createdCount,
      reusedCount,
      knowledgeBaseAttachmentCount,
      cardAttachmentCount,
    },
  };
}

function normalizeSourceImportAttachmentPlanItem(item) {
  const ownerScope = normalizeNonEmptyString(item?.ownerScope, 'attachmentPlanItem.ownerScope');
  const relativePath = normalizeNonEmptyString(item?.relativePath, 'attachmentPlanItem.relativePath');
  const fileName = normalizeNonEmptyString(item?.fileName, 'attachmentPlanItem.fileName');
  const localFilePath = normalizeNonEmptyString(item?.localFilePath, 'attachmentPlanItem.localFilePath');
  const attachmentRef = normalizeNonEmptyString(item?.attachmentRef, 'attachmentPlanItem.attachmentRef');
  const mimeType = normalizeNonEmptyString(item?.mimeType, 'attachmentPlanItem.mimeType');
  const sizeBytes = toFiniteNumber(item?.sizeBytes);
  if (sizeBytes <= 0) {
    throw new Error(`attachment plan item sizeBytes is invalid: ${relativePath}`);
  }

  if (ownerScope === 'knowledge_base') {
    return {
      ownerScope,
      ownerCardPath: null,
      relativePath,
      fileName,
      localFilePath,
      attachmentRef,
      mimeType,
      sizeBytes,
      plannedKnowledgeBaseId: normalizeNonEmptyString(
        item?.plannedKnowledgeBaseId,
        'attachmentPlanItem.plannedKnowledgeBaseId',
      ),
      plannedCardId: null,
    };
  }
  if (ownerScope === 'card') {
    return {
      ownerScope,
      ownerCardPath:
        typeof item?.ownerCardPath === 'string' && item.ownerCardPath.trim()
          ? item.ownerCardPath.trim()
          : null,
      relativePath,
      fileName,
      localFilePath,
      attachmentRef,
      mimeType,
      sizeBytes,
      plannedKnowledgeBaseId: normalizeNonEmptyString(
        item?.plannedKnowledgeBaseId,
        'attachmentPlanItem.plannedKnowledgeBaseId',
      ),
      plannedCardId: normalizeNonEmptyString(
        item?.plannedCardId,
        'attachmentPlanItem.plannedCardId',
      ),
    };
  }

  throw new Error(`unsupported attachment plan ownerScope: ${ownerScope}`);
}

function buildSourceImportAttachmentJobId(importJobId, relativePath) {
  return `import-attachment:${importJobId}:${createHash('sha1').update(relativePath).digest('hex')}`;
}

function materializeSourceImportStructure(input) {
  const localDbService = input?.localDbService;
  if (!localDbService) {
    throw new Error('localDbService is required for source import structure materialization');
  }
  if (typeof localDbService.createKnowledgeBase !== 'function') {
    throw new Error('localDbService.createKnowledgeBase is required for source import structure');
  }
  if (typeof localDbService.getKnowledgeBase !== 'function') {
    throw new Error('localDbService.getKnowledgeBase is required for source import structure');
  }
  if (typeof localDbService.createCard !== 'function' || typeof localDbService.getCard !== 'function') {
    throw new Error('localDbService card APIs are required for source import structure');
  }

  const workspaceId = normalizeNonEmptyString(input.workspaceId, 'workspaceId');
  const importedKbPath = normalizeNonEmptyString(input.importedKbPath, 'importedKbPath');
  const knowledgeBaseId =
    typeof input?.entityMapping?.knowledgeBaseId === 'string'
      ? input.entityMapping.knowledgeBaseId
      : null;
  if (!knowledgeBaseId) {
    throw new Error('source import entity mapping is missing planned knowledge base id');
  }

  const mappingItemsByLegacyPath = isRecord(input?.entityMapping?.itemsByLegacyPath)
    ? input.entityMapping.itemsByLegacyPath
    : {};
  const items = [];
  const knowledgeBaseName = nodePath.basename(importedKbPath);
  const existingKnowledgeBase = localDbService.getKnowledgeBase(knowledgeBaseId);
  if (existingKnowledgeBase && existingKnowledgeBase.workspaceId !== workspaceId) {
    throw new Error(`planned knowledge base already belongs to another workspace: ${knowledgeBaseId}`);
  }

  let knowledgeBaseAction = 'existing';
  if (!existingKnowledgeBase) {
    localDbService.createKnowledgeBase({
      workspaceId,
      knowledgeBaseId,
      name: knowledgeBaseName,
      description: null,
      coverAttachmentId: null,
      settingsJson: {
        importedFrom: 'source_import_kb',
        importedKbPath,
      },
    });
    knowledgeBaseAction = 'created';
  }

  items.push({
    entityType: 'knowledge_base',
    plannedId: knowledgeBaseId,
    legacyPath: '',
    parentLegacyPath: null,
    name: knowledgeBaseName,
    action: knowledgeBaseAction,
  });

  let cardCreatedCount = 0;
  let cardReusedCount = 0;
  const cardMappings = Object.values(mappingItemsByLegacyPath)
    .filter((item) => isRecord(item) && item.entityType === 'card')
    .sort(compareEntityMappingItemsForImport);

  for (const mappingItem of cardMappings) {
    const plannedId = typeof mappingItem.plannedId === 'string' ? mappingItem.plannedId : null;
    const legacyPath = typeof mappingItem.legacyPath === 'string' ? mappingItem.legacyPath : '';
    const parentLegacyPath =
      typeof mappingItem.parentLegacyPath === 'string' ? mappingItem.parentLegacyPath : null;
    if (!plannedId || !legacyPath) {
      throw new Error('source import card mapping item is missing plannedId or legacyPath');
    }

    const cardName =
      typeof mappingItem.legacyFolderName === 'string' && mappingItem.legacyFolderName.trim()
        ? mappingItem.legacyFolderName.trim()
        : basenamePortablePath(legacyPath);
    const existingCard = localDbService.getCard(plannedId);
    if (existingCard && existingCard.workspaceId !== workspaceId) {
      throw new Error(`planned card already belongs to another workspace: ${plannedId}`);
    }

    let action = 'existing';
    if (!existingCard) {
      const parentMapping = parentLegacyPath ? mappingItemsByLegacyPath[parentLegacyPath] : null;
      const parentId =
        parentLegacyPath && isRecord(parentMapping) && typeof parentMapping.plannedId === 'string'
          ? parentMapping.plannedId
          : null;
      if (parentLegacyPath && !parentId) {
        throw new Error(`source import card mapping is missing parent mapping: ${legacyPath}`);
      }

      localDbService.createCard({
        workspaceId,
        cardId: plannedId,
        kbId: knowledgeBaseId,
        parentId,
        name: cardName,
        metaJson: {
          importedFrom: 'source_import_kb',
          legacyPath,
        },
      });
      action = 'created';
      cardCreatedCount += 1;
    } else {
      cardReusedCount += 1;
    }

    items.push({
      entityType: 'card',
      plannedId,
      legacyPath,
      parentLegacyPath,
      name: cardName,
      action,
    });
  }

  return {
    status: 'done',
    knowledgeBaseId,
    items,
    summary: {
      knowledgeBaseCreatedCount: knowledgeBaseAction === 'created' ? 1 : 0,
      knowledgeBaseReusedCount: knowledgeBaseAction === 'existing' ? 1 : 0,
      cardCreatedCount,
      cardReusedCount,
      totalCardCount: cardMappings.length,
    },
  };
}

function getSourceImportCheckpoint(job) {
  const summaryJson = isRecord(job?.summaryJson) ? job.summaryJson : {};
  const sourceImport = isRecord(summaryJson.sourceImport) ? summaryJson.sourceImport : {};
  const importedKbPath =
    typeof sourceImport.importedKbPath === 'string' && sourceImport.importedKbPath.trim()
      ? sourceImport.importedKbPath.trim()
      : typeof summaryJson.importedKbPath === 'string' && summaryJson.importedKbPath.trim()
        ? summaryJson.importedKbPath.trim()
        : '';

  if (!importedKbPath) {
    return {
      importedKbPath: null,
    };
  }
  if (!nodeFs.existsSync(importedKbPath) || !nodeFs.statSync(importedKbPath).isDirectory()) {
    return {
      importedKbPath: null,
    };
  }

  return {
    importedKbPath,
  };
}

function buildSourceImportAttachmentPlan(importedKbPath) {
  const rootDir = nodePath.resolve(normalizeNonEmptyString(importedKbPath, 'importedKbPath'));
  if (!nodeFs.existsSync(rootDir)) {
    throw new Error(`目录导入结果不存在，无法规划附件: ${rootDir}`);
  }
  if (!nodeFs.statSync(rootDir).isDirectory()) {
    throw new Error(`目录导入结果不是目录，无法规划附件: ${rootDir}`);
  }

  const items = [];
  const warnings = [];
  const summary = {
    totalCount: 0,
    totalBytes: 0,
    attachmentDirCount: 0,
    cardAttachmentCount: 0,
    knowledgeBaseAttachmentCount: 0,
  };

  walkDir(rootDir);

  return {
    scannedAt: new Date().toISOString(),
    rootDir,
    summary,
    warnings,
    items,
  };

  function walkDir(currentDir) {
    const entries = nodeFs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.trash') {
        continue;
      }
      if (entry.isSymbolicLink()) {
        warnings.push({
          code: 'SKIP_SYMLINK',
          path: toPortableRelativePath(rootDir, nodePath.join(currentDir, entry.name)),
        });
        continue;
      }

      const absolutePath = nodePath.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '_attach') {
          collectAttachmentDir(absolutePath);
          continue;
        }
        walkDir(absolutePath);
      }
    }
  }

  function collectAttachmentDir(attachDir) {
    summary.attachmentDirCount += 1;
    const ownerDir = nodePath.dirname(attachDir);
    const ownerRelativePath = toPortableRelativePath(rootDir, ownerDir);
    const ownerScope = ownerRelativePath ? 'card' : 'knowledge_base';
    const attachmentEntries = nodeFs.readdirSync(attachDir, { withFileTypes: true });

    for (const entry of attachmentEntries) {
      const absolutePath = nodePath.join(attachDir, entry.name);
      if (entry.isSymbolicLink()) {
        warnings.push({
          code: 'SKIP_SYMLINK',
          path: toPortableRelativePath(rootDir, absolutePath),
        });
        continue;
      }
      if (!entry.isFile()) {
        warnings.push({
          code: 'SKIP_NON_FILE',
          path: toPortableRelativePath(rootDir, absolutePath),
        });
        continue;
      }

      const stat = nodeFs.statSync(absolutePath);
      const relativePath = toPortableRelativePath(rootDir, absolutePath);
      items.push({
        ownerScope,
        ownerCardPath: ownerRelativePath || null,
        attachmentRef: `_attach/${entry.name}`,
        fileName: entry.name,
        relativePath,
        localFilePath: absolutePath,
        sizeBytes: stat.size,
        mimeType: detectMimeTypeFromFileName(entry.name),
        plannedFrom: 'source_import_kb',
      });
      summary.totalCount += 1;
      summary.totalBytes += stat.size;
      if (ownerScope === 'card') {
        summary.cardAttachmentCount += 1;
      } else {
        summary.knowledgeBaseAttachmentCount += 1;
      }
    }
  }
}

function buildSourceImportEntityMapping(importedKbPath, previousSummaryJson) {
  const rootDir = nodePath.resolve(normalizeNonEmptyString(importedKbPath, 'importedKbPath'));
  const previousMapping = readSourceImportEntityMapping(previousSummaryJson);
  const itemsByLegacyPath = {};
  let reusedLegacyIdCount = 0;
  let generatedIdCount = 0;

  const knowledgeBaseId = assignEntityId('', nodePath.basename(rootDir), 'knowledge_base');

  walkCardDirs(rootDir, '');

  // Preserve checkpointed card mappings that were introduced by attachment-owner discovery.
  // Without this, a resumed `push` stage can generate a new planned card id for folders that
  // only contain `_attach/` and no `_graph.json`, which would create duplicate local cards/outbox.
  for (const [legacyPath, mappingItem] of Object.entries(previousMapping.itemsByLegacyPath)) {
    if (legacyPath === '' || itemsByLegacyPath[legacyPath] || !isRecord(mappingItem)) {
      continue;
    }
    if (mappingItem.entityType !== 'card') {
      continue;
    }
    itemsByLegacyPath[legacyPath] = {
      entityType: 'card',
      plannedId: normalizeNonEmptyString(mappingItem.plannedId, `entityMapping.${legacyPath}.plannedId`),
      idSource:
        typeof mappingItem.idSource === 'string' && mappingItem.idSource.trim()
          ? mappingItem.idSource.trim()
          : 'generated_uuid',
      legacyPath,
      legacyFolderName:
        typeof mappingItem.legacyFolderName === 'string' ? mappingItem.legacyFolderName : basenamePortablePath(legacyPath),
      parentLegacyPath:
        typeof mappingItem.parentLegacyPath === 'string' && mappingItem.parentLegacyPath.trim()
          ? mappingItem.parentLegacyPath.trim()
          : parentPortablePath(legacyPath),
    };
  }

  reusedLegacyIdCount = 0;
  generatedIdCount = 0;
  for (const mappingItem of Object.values(itemsByLegacyPath)) {
    if (!isRecord(mappingItem)) {
      continue;
    }
    if (mappingItem.idSource === 'reused_legacy_key') {
      reusedLegacyIdCount += 1;
    }
    if (mappingItem.idSource === 'generated_uuid') {
      generatedIdCount += 1;
    }
  }

  return {
    status: 'planned',
    knowledgeBaseId,
    itemsByLegacyPath,
    summary: {
      cardCount: Math.max(Object.keys(itemsByLegacyPath).length - 1, 0),
      reusedLegacyIdCount,
      generatedIdCount,
    },
  };

  function walkCardDirs(currentDir, currentLegacyPath) {
    const entries = nodeFs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (
        entry.name === '_attach' ||
        entry.name === '_docs' ||
        entry.name === '.trash' ||
        entry.name === 'node_modules'
      ) {
        continue;
      }

      const childDir = nodePath.join(currentDir, entry.name);
      const graphPath = nodePath.join(childDir, '_graph.json');
      if (!nodeFs.existsSync(graphPath) || !nodeFs.statSync(graphPath).isFile()) {
        continue;
      }

      const childLegacyPath = currentLegacyPath
        ? `${currentLegacyPath}/${entry.name}`
        : entry.name;
      assignEntityId(childLegacyPath, entry.name, 'card', currentLegacyPath || null);
      walkCardDirs(childDir, childLegacyPath);
    }
  }

  function assignEntityId(legacyPath, legacyFolderName, entityType, parentLegacyPath = null) {
    const existing = isRecord(previousMapping.itemsByLegacyPath?.[legacyPath])
      ? previousMapping.itemsByLegacyPath[legacyPath]
      : null;
    const existingPlannedId =
      typeof existing?.plannedId === 'string' && isUuidString(existing.plannedId)
        ? existing.plannedId
        : null;
    const reusableLegacyId = isUuidString(legacyFolderName) ? legacyFolderName : null;
    const plannedId = existingPlannedId ?? reusableLegacyId ?? randomUUID();
    const idSource = existingPlannedId
      ? 'checkpoint'
      : reusableLegacyId
        ? 'reused_legacy_key'
        : 'generated_uuid';

    itemsByLegacyPath[legacyPath] = {
      entityType,
      plannedId,
      idSource,
      legacyPath,
      legacyFolderName,
      parentLegacyPath,
    };
    if (idSource === 'reused_legacy_key') {
      reusedLegacyIdCount += 1;
    }
    if (idSource === 'generated_uuid') {
      generatedIdCount += 1;
    }
    return plannedId;
  }
}

function decorateAttachmentPlanWithEntityMapping(attachmentPlan, entityMapping) {
  const items = Array.isArray(attachmentPlan?.items) ? attachmentPlan.items : [];
  const warnings = Array.isArray(attachmentPlan?.warnings) ? attachmentPlan.warnings : [];
  const mappingItemsByLegacyPath = isRecord(entityMapping?.itemsByLegacyPath)
    ? entityMapping.itemsByLegacyPath
    : {};
  const plannedKnowledgeBaseId =
    typeof entityMapping?.knowledgeBaseId === 'string' ? entityMapping.knowledgeBaseId : null;

  let resolvedOwnerCount = 0;
  let unresolvedOwnerCount = 0;

  const nextItems = items.map((item) => {
    const ownerMapping =
      item?.ownerScope === 'card' && typeof item?.ownerCardPath === 'string'
        ? mappingItemsByLegacyPath[item.ownerCardPath] ?? null
        : null;
    const plannedCardId =
      typeof ownerMapping?.plannedId === 'string' ? ownerMapping.plannedId : null;
    const mappingStatus =
      item?.ownerScope === 'knowledge_base'
        ? plannedKnowledgeBaseId
          ? 'resolved'
          : 'missing_knowledge_base_mapping'
        : plannedKnowledgeBaseId && plannedCardId
          ? 'resolved'
          : 'missing_card_mapping';

    if (mappingStatus === 'resolved') {
      resolvedOwnerCount += 1;
    } else {
      unresolvedOwnerCount += 1;
    }

    return {
      ...item,
      plannedKnowledgeBaseId,
      plannedCardId,
      mappingStatus,
    };
  });

  return {
    ...attachmentPlan,
    warnings,
    summary: {
      ...(isRecord(attachmentPlan?.summary) ? attachmentPlan.summary : {}),
      resolvedOwnerCount,
      unresolvedOwnerCount,
    },
    items: nextItems,
  };
}

function extendSourceImportEntityMappingWithAttachmentPlan(entityMapping, attachmentPlan) {
  const baseItemsByLegacyPath = isRecord(entityMapping?.itemsByLegacyPath)
    ? entityMapping.itemsByLegacyPath
    : {};
  const nextItemsByLegacyPath = { ...baseItemsByLegacyPath };
  const items = Array.isArray(attachmentPlan?.items) ? attachmentPlan.items : [];
  let reusedLegacyIdCount = 0;
  let generatedIdCount = 0;

  for (const mappingItem of Object.values(nextItemsByLegacyPath)) {
    if (!isRecord(mappingItem)) {
      continue;
    }
    if (mappingItem.idSource === 'reused_legacy_key') {
      reusedLegacyIdCount += 1;
    }
    if (mappingItem.idSource === 'generated_uuid') {
      generatedIdCount += 1;
    }
  }

  for (const item of items) {
    if (item?.ownerScope !== 'card' || typeof item?.ownerCardPath !== 'string' || !item.ownerCardPath) {
      continue;
    }
    if (isRecord(nextItemsByLegacyPath[item.ownerCardPath])) {
      continue;
    }

    const legacyFolderName = basenamePortablePath(item.ownerCardPath);
    const reusableLegacyId = isUuidString(legacyFolderName) ? legacyFolderName : null;
    const plannedId = reusableLegacyId ?? randomUUID();
    const idSource = reusableLegacyId ? 'reused_legacy_key' : 'generated_uuid';
    nextItemsByLegacyPath[item.ownerCardPath] = {
      entityType: 'card',
      plannedId,
      idSource,
      legacyPath: item.ownerCardPath,
      legacyFolderName,
      parentLegacyPath: parentPortablePath(item.ownerCardPath),
    };
    if (idSource === 'reused_legacy_key') {
      reusedLegacyIdCount += 1;
    }
    if (idSource === 'generated_uuid') {
      generatedIdCount += 1;
    }
  }

  return {
    ...entityMapping,
    itemsByLegacyPath: nextItemsByLegacyPath,
    summary: {
      cardCount: Math.max(Object.keys(nextItemsByLegacyPath).length - 1, 0),
      reusedLegacyIdCount,
      generatedIdCount,
    },
  };
}

function readSourceImportEntityMapping(summaryJson) {
  const entityMapping = isRecord(summaryJson?.entityMapping) ? summaryJson.entityMapping : {};
  return {
    knowledgeBaseId:
      typeof entityMapping.knowledgeBaseId === 'string' && isUuidString(entityMapping.knowledgeBaseId)
        ? entityMapping.knowledgeBaseId
        : null,
    itemsByLegacyPath: isRecord(entityMapping.itemsByLegacyPath)
      ? entityMapping.itemsByLegacyPath
      : {},
  };
}

function isUuidString(value) {
  if (typeof value !== 'string') {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function basenamePortablePath(value) {
  const normalized = typeof value === 'string' ? value.replace(/\\/g, '/').replace(/\/+$/g, '') : '';
  if (!normalized) {
    return '';
  }
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function parentPortablePath(value) {
  const normalized = typeof value === 'string' ? value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
  if (!normalized || !normalized.includes('/')) {
    return null;
  }
  return normalized.slice(0, normalized.lastIndexOf('/')) || null;
}

function detectMimeTypeFromFileName(fileName) {
  const extension = nodePath.extname(String(fileName || '')).slice(1).toLowerCase();
  const mimeByExtension = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    pdf: 'application/pdf',
  };
  return mimeByExtension[extension] || 'application/octet-stream';
}

function compareEntityMappingItemsForImport(left, right) {
  const leftPath = typeof left?.legacyPath === 'string' ? left.legacyPath : '';
  const rightPath = typeof right?.legacyPath === 'string' ? right.legacyPath : '';
  const leftDepth = leftPath ? leftPath.split('/').length : 0;
  const rightDepth = rightPath ? rightPath.split('/').length : 0;
  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }
  return leftPath.localeCompare(rightPath);
}

function isImportStructureEntityType(value) {
  return value === 'knowledge_base' || value === 'card';
}

function toPortableRelativePath(rootDir, targetPath) {
  const relativePath = nodePath.relative(rootDir, targetPath);
  if (!relativePath || relativePath === '.') {
    return '';
  }
  return relativePath.split(nodePath.sep).join('/');
}

function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStartImportJobInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('import start input must be an object');
  }

  const workspaceId = normalizeNonEmptyString(value.workspaceId, 'importStart.workspaceId');
  const sourcePath = nodePath.resolve(
    normalizeNonEmptyString(value.sourcePath, 'importStart.sourcePath'),
  );
  if (!nodeFs.existsSync(sourcePath)) {
    throw new Error(`导入目录不存在: ${sourcePath}`);
  }

  const stat = nodeFs.statSync(sourcePath);
  if (!stat.isDirectory()) {
    throw new Error(`导入源必须是目录: ${sourcePath}`);
  }

  return {
    workspaceId,
    sourcePath,
  };
}

function normalizeNonEmptyString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

