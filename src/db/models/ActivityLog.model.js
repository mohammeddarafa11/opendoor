import mongoose from "mongoose";

const activityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    action: {
      type: String,
      required: true,
      enum: [
        "user_login",
        "user_register",
        "reservation_created",
        "reservation_confirmed",
        "reservation_cancelled",
        "reservation_expired",
        "payment_made",
        "payment_verified",
        "payment_refunded",
        "unit_created",
        "unit_updated",
        "unit_deleted",
        "waitlist_joined",
        "waitlist_notified",
        "waitlist_expired",
        "waitlist_converted",
        "agent_assigned",
        "user_suspended",
        "user_activated",
        "document_uploaded",
        "sms_sent",
        "email_sent",
      ],
    },
    details: {
      type: String,
    },
    target_type: {
      type: String,
      enum: [
        "User",
        "Unit",
        "Reservation",
        "Payment",
        "Waitlist",
        "Project",
        "Block",
      ],
    },
    target_id: {
      type: mongoose.Schema.Types.ObjectId,
    },
    ip_address: {
      type: String,
    },
    user_agent: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ action: 1 });
activityLogSchema.index({ target_type: 1, target_id: 1 });

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);
export default ActivityLog;
