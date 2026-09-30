import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AdminBootstrapService } from "./admin-bootstrap.service.js";
import { DatabaseRepository } from "./database.repository.js";
import { CatalogController } from "./catalog.controller.js";
import { CommerceController } from "./commerce.controller.js";
import { HealthController } from "./health.controller.js";
import { IdentityService } from "./identity.service.js";
import { OperationsController } from "./operations.controller.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  controllers: [HealthController, AuthController, CatalogController, CommerceController, OperationsController, PaymentsController],
  providers: [PrismaService, DatabaseRepository, PaymentsService, IdentityService, AdminBootstrapService]
})
export class AppModule {}
