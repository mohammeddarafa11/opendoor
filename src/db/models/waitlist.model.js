import mongoose from "mongoose";

const waitlistSchema = new mongoose.Schema(
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
    position: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "notified", "converted", "expired", "removed"],
      default: "active",
    },
    notification_preferences: {
      sms: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
    },
    notified_at: Date,
    expires_at: Date,
    converted_at: Date,
    removed_at: Date,
    expired_at: Date,
  },
  {
    timestamps: true,
  },
);

// Ensure one user per unit on waitlist
waitlistSchema.index({ user: 1, unit: 1 }, { unique: true });
waitlistSchema.index({ unit: 1, status: 1, position: 1 });

const Waitlist = mongoose.model("Waitlist", waitlistSchema);
export default Waitlist;
