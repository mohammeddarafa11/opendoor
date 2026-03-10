import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    payment_type: {
      type: String,
      enum: ["reservation_fee", "down_payment", "installment", "full_payment"],
      required: true,
    },
    payment_method: {
      type: String,
      enum: ["credit_card", "fawry", "vodafone_cash", "bank_transfer"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },
    transaction_id: {
      type: String,
    },
    paymob_order_id: {
      type: String,
    },
    receipt_url: {
      type: String,
    },
    paid_at: {
      type: Date,
    },
    notes: {
      type: String,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  },
);

const Payment = mongoose.model("Payment", paymentSchema);
export default Payment;
