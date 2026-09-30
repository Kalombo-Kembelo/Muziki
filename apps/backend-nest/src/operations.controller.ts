import { Get, Controller } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Controller("api")
export class OperationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("notifications")
  async notifications() {
    return this.prisma.notification.findMany();
  }
}
