import { Controller, Get, Res, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { PrometheusService } from "../../observability/prometheus-metrics";

@Controller("metrics")
export class MetricsController {
  private readonly prometheus = PrometheusService.getInstance();

  @Get()
  public async getMetrics(@Res() res: Response) {
    const metrics = await this.prometheus.getMetrics();
    res.setHeader("Content-Type", this.prometheus.getContentType());
    return res.status(HttpStatus.OK).send(metrics);
  }
}
