import { Controller, Get, Res, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { PostgresDatabaseService } from "../../database/pg-database";

@Controller("health")
export class HealthController {
  constructor(private readonly dbService?: PostgresDatabaseService) {}

  @Get("live")
  public live(@Res() res: Response) {
    return res.status(HttpStatus.OK).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  @Get("ready")
  public async ready(@Res() res: Response) {
    let pgOk = false;
    let sqsOk = false;
    const checks: Record<string, string> = {};

    // 1. PostgreSQL Check
    try {
      if (this.dbService) {
        await this.dbService.query("SELECT 1");
        pgOk = true;
        checks.postgres = "reachable";
      } else {
        pgOk = true;
        checks.postgres = "embedded_or_mock";
      }
    } catch (err: any) {
      checks.postgres = `unreachable: ${err?.message || "error"}`;
    }

    // 2. AWS SQS / LocalStack Check
    const sqsEndpoint = process.env.SQS_ENDPOINT || "http://localhost:4566";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const resp = await fetch(`${sqsEndpoint}/_localstack/health`, {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeout);

      if (resp && resp.ok) {
        sqsOk = true;
        checks.sqs = "reachable";
      } else {
        // Fallback or development tolerance if running without external docker daemon
        checks.sqs = resp ? `status_${resp.status}` : "localstack_offline";
        // If LocalStack is not up in test environment, flag accordingly
        sqsOk = process.env.NODE_ENV === "test" || !process.env.STRICT_HEALTH_CHECK;
      }
    } catch {
      checks.sqs = "unreachable";
      sqsOk = process.env.NODE_ENV === "test" || !process.env.STRICT_HEALTH_CHECK;
    }

    const isReady = pgOk && sqsOk;
    const statusCode = isReady ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;

    return res.status(statusCode).json({
      status: isReady ? "ok" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    });
  }
}
