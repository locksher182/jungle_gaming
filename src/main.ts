import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DomainExceptionFilter } from "./infrastructure/http/filters/domain-exception.filter";
import { StructuredLogger } from "./infrastructure/observability/logger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new DomainExceptionFilter());

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  StructuredLogger.info(`Application is running on port ${port}`);

  process.on("SIGTERM", async () => {
    StructuredLogger.info("SIGTERM received, gracefully closing application...");
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  StructuredLogger.error("Failed to bootstrap application", err);
  process.exit(1);
});
