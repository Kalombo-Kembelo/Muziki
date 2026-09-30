import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { PaymentsService } from "./payments.service.js";

@Controller("api/payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("flexpaie/checkout")
  checkout(@Body() body: { songId?: string; userId?: string; method?: string; amountCdf?: number; returnUrl?: string }) {
    return this.payments.createFlexpaieCheckout(body);
  }

  @Post("flexpaie/webhook")
  webhook(
    @Body() body: Record<string, unknown>,
    @Headers("x-flexpaie-signature") signature?: string,
    @Headers("x-signature") alternateSignature?: string
  ) {
    return this.payments.handleFlexpaieWebhook(body, signature || alternateSignature);
  }

  @Get(":reference")
  payment(@Param("reference") reference: string) {
    return this.payments.getPurchaseByReference(reference);
  }
}
