import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get("live")
  @HttpCode(HttpStatus.OK)
  public live() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  @HttpCode(HttpStatus.OK)
  public ready() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
