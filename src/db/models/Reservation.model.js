import mongoose from "mongoose";

const reservationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: true,
    },
    reservation_number: {
      type: String,
      unique: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "expired", "completed"],
      default: "pending",
    },
    reservation_fee: {
      type: Number,
      default: 5000,
    },
    total_price: {
      type: Number,
      required: true,
    },
    down_payment: {
      type: Number,
      default: 0,
    },
    installment_plan: {
      duration_months: { type: Number, default: 48 },
      monthly_amount: { type: Number, default: 0 },
      down_payment_percentage: { type: Number, default: 5 },
    },
    assigned_agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      maxlength: 500,
    },
    confirmed_at: Date,
    cancelled_at: Date,
    cancellation_reason: String,
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  {
    timestamps: true,
  },
);

reservationSchema.pre("save", async function () {
  if (!this.reservation_number) {
    const count = await mongoose.model("Reservation").countDocuments();
    this.reservation_number = `RES-${String(count + 1).padStart(5, "0")}`;
  }
});

// Indexes
reservationSchema.index({ user: 1, status: 1 });
reservationSchema.index({ unit: 1 });
reservationSchema.index({ assigned_agent: 1 });
reservationSchema.index({ status: 1 });
reservationSchema.index({ expires_at: 1 });

const Reservation = mongoose.model("Reservation", reservationSchema);
export default Reservation;
