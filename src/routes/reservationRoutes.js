import express from "express";
import Reservation from "../db/models/Reservation.model.js";
import Unit from "../db/models/unit.model.js";
import Waitlist from "../db/models/waitlist.model.js";
import User from "../db/models/User.model.js";
import ActivityLog from "../db/models/ActivityLog.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import {
  validate,
  createReservationSchema,
} from "../middleware/validation.middleware.js";
import { sendEmail } from "../config/emailService.js";

const router = express.Router();

// All reservation routes require auth
router.use(authMiddleware);

// Create reservation (customer)
router.post("/", validate(createReservationSchema), async (req, res) => {
  try {
    const { unit: unitId, notes } = req.body;

    // Check if unit exists and is available
    const unit = await Unit.findById(unitId).populate("project", "name");
    if (!unit) {
      return res.status(404).json({ message: "Unit not found" });
    }

    if (unit.status !== "available") {
      return res.status(400).json({
        message: `Unit is currently ${unit.status}. You can join the waiting list instead.`,
      });
    }

    // Check if user already has active reservation for this unit
    const existingReservation = await Reservation.findOne({
      user: req.userId,
      unit: unitId,
      status: { $in: ["pending", "confirmed"] },
    });

    if (existingReservation) {
      return res.status(400).json({
        message: "You already have an active reservation for this unit",
      });
    }

    // Calculate installment plan from unit settings
    const downPaymentAmount = unit.price * (unit.down_payment_percentage / 100);
    const remaining = unit.price - downPaymentAmount - unit.reservation_fee;
    const monthlyAmount = Math.ceil(remaining / unit.installment_months);

    // Create reservation
    const reservation = new Reservation({
      user: req.userId,
      unit: unitId,
      total_price: unit.price,
      reservation_fee: unit.reservation_fee,
      down_payment: downPaymentAmount,
      installment_plan: {
        duration_months: unit.installment_months,
        monthly_amount: monthlyAmount,
        down_payment_percentage: unit.down_payment_percentage,
      },
      notes,
    });

    await reservation.save();

    // Update unit status to reserved
    unit.status = "reserved";
    await unit.save();

    // Convert user from waitlist if they were on it
    await Waitlist.findOneAndUpdate(
      {
        user: req.userId,
        unit: unitId,
        status: { $in: ["active", "notified"] },
      },
      { status: "converted", converted_at: new Date() },
    );

    // Log activity
    await ActivityLog.create({
      user: req.userId,
      action: "reservation_created",
      details: `Reservation ${reservation.reservation_number} created for unit ${unit.unit_number}`,
      target_type: "Reservation",
      target_id: reservation._id,
      ip_address: req.ip,
    });

    // Send confirmation email
    try {
      const user = await User.findById(req.userId);
      await sendEmail({
        to: user.email,
        subject: `✅ Reservation Confirmed - ${reservation.reservation_number}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #2e7d32;">🎉 Congratulations! Unit Reserved!</h1>
            <p>Dear ${user.name},</p>
            <p>Your reservation has been created successfully.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Reservation #</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${reservation.reservation_number}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Unit</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${unit.unit_number}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Project</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${unit.project?.name || "N/A"}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Price</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${unit.price.toLocaleString()} EGP</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Reservation Fee</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${unit.reservation_fee.toLocaleString()} EGP</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Monthly Installment</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${monthlyAmount.toLocaleString()} EGP/month</td></tr>
            </table>
            <p>We'll contact you within 24 hours to complete the process.</p>
            <p>Best regards,<br>K Developments Team<br>📞 19844</p>
          </div>
        `,
      });
    } catch (emailError) {
      console.error("Email send failed:", emailError.message);
    }

    await reservation.populate(
      "unit",
      "unit_number property_type price area_sqm bedrooms bathrooms",
    );

    res.status(201).json({
      message: "Reservation created successfully",
      reservation,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get my reservations (customer)
router.get("/my", async (req, res) => {
  try {
    const reservations = await Reservation.find({ user: req.userId })
      .populate(
        "unit",
        "unit_number property_type price images status area_sqm bedrooms bathrooms",
      )
      .populate("assigned_agent", "name email phone")
      .sort({ createdAt: -1 });

    res.json(reservations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all reservations (manager/admin/agent)
router.get("/", authorize("admin", "manager", "agent"), async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let filter = {};
    if (status) filter.status = status;

    // Agents only see their assigned reservations
    if (req.user.role === "agent") {
      filter.assigned_agent = req.userId;
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [reservations, total] = await Promise.all([
      Reservation.find(filter)
        .populate("unit", "unit_number property_type price")
        .populate("user", "name email phone")
        .populate("assigned_agent", "name email phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Reservation.countDocuments(filter),
    ]);

    res.json({
      reservations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single reservation
router.get("/:id", async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id)
      .populate("unit")
      .populate("user", "name email phone national_id address documents")
      .populate("assigned_agent", "name email phone");

    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found" });
    }

    // Customers can only see their own
    if (
      req.user.role === "customer" &&
      reservation.user._id.toString() !== req.userId
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(reservation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Confirm reservation (manager/admin)
router.patch(
  "/:id/confirm",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const reservation = await Reservation.findById(req.params.id);

      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      if (reservation.status !== "pending") {
        return res
          .status(400)
          .json({
            message: `Cannot confirm a ${reservation.status} reservation`,
          });
      }

      reservation.status = "confirmed";
      reservation.confirmed_at = new Date();
      await reservation.save();

      // Log activity
      await ActivityLog.create({
        user: req.userId,
        action: "reservation_confirmed",
        details: `Reservation ${reservation.reservation_number} confirmed`,
        target_type: "Reservation",
        target_id: reservation._id,
      });

      res.json({ message: "Reservation confirmed", reservation });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Cancel reservation (customer/manager/admin)
router.patch("/:id/cancel", async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id).populate(
      "unit",
    );

    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found" });
    }

    // Customers can only cancel their own
    if (
      req.user.role === "customer" &&
      reservation.user.toString() !== req.userId
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (["cancelled", "completed"].includes(reservation.status)) {
      return res
        .status(400)
        .json({ message: `Cannot cancel a ${reservation.status} reservation` });
    }

    reservation.status = "cancelled";
    reservation.cancelled_at = new Date();
    reservation.cancellation_reason =
      req.body.reason || "Customer requested cancellation";
    await reservation.save();

    // Make unit available again
    if (reservation.unit) {
      await Unit.findByIdAndUpdate(reservation.unit._id, {
        status: "available",
      });

      // Notify first person on waitlist (spec Section 4)
      const nextInLine = await Waitlist.findOne({
        unit: reservation.unit._id,
        status: "active",
      })
        .sort({ position: 1 })
        .populate("user", "name email phone");

      if (nextInLine) {
        nextInLine.status = "notified";
        nextInLine.notified_at = new Date();
        nextInLine.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await nextInLine.save();

        // Log waitlist notification
        await ActivityLog.create({
          user: nextInLine.user._id,
          action: "waitlist_notified",
          details: `Notified about unit ${reservation.unit.unit_number} availability. 24 hours to reserve.`,
          target_type: "Waitlist",
          target_id: nextInLine._id,
        });

        // Send notification email
        try {
          await sendEmail({
            to: nextInLine.user.email,
            subject: "🎉 Great News! Unit is now available!",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #2e7d32;">🎉 Great News!</h1>
                <p>Dear ${nextInLine.user.name},</p>
                <p>Unit <strong>${reservation.unit.unit_number}</strong> is now available!</p>
                <p>You have <strong>24 hours</strong> to reserve it before the next person is notified.</p>
                <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/units/${reservation.unit._id}" 
                   style="display: inline-block; padding: 12px 24px; background: #2e7d32; color: white; text-decoration: none; border-radius: 4px; margin-top: 16px;">
                  Reserve Now
                </a>
                <p style="margin-top: 16px;">Best regards,<br>K Developments Team<br>📞 19844</p>
              </div>
            `,
          });
        } catch (emailError) {
          console.error(
            "Waitlist notification email failed:",
            emailError.message,
          );
        }
      }
    }

    // Log activity
    await ActivityLog.create({
      user: req.userId,
      action: "reservation_cancelled",
      details: `Reservation ${reservation.reservation_number} cancelled. Reason: ${reservation.cancellation_reason}`,
      target_type: "Reservation",
      target_id: reservation._id,
    });

    res.json({ message: "Reservation cancelled", reservation });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Assign agent to reservation (manager/admin)
router.patch(
  "/:id/assign-agent",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { agentId } = req.body;

      if (!agentId) {
        return res.status(400).json({ message: "Agent ID is required" });
      }

      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "agent") {
        return res.status(400).json({ message: "Invalid agent" });
      }

      if (!agent.is_active) {
        return res.status(400).json({ message: "Agent is suspended" });
      }

      const reservation = await Reservation.findByIdAndUpdate(
        req.params.id,
        { assigned_agent: agentId },
        { new: true },
      )
        .populate("unit", "unit_number")
        .populate("user", "name email phone")
        .populate("assigned_agent", "name email phone");

      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      // Add customer to agent's assigned list
      await User.findByIdAndUpdate(agentId, {
        $addToSet: { assigned_customers: reservation.user._id },
      });

      // Assign agent to customer profile too
      await User.findByIdAndUpdate(reservation.user._id, {
        assigned_agent: agentId,
      });

      // Log activity
      await ActivityLog.create({
        user: req.userId,
        action: "agent_assigned",
        details: `Agent ${agent.name} assigned to reservation ${reservation.reservation_number}`,
        target_type: "Reservation",
        target_id: reservation._id,
      });

      res.json({ message: "Agent assigned", reservation });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

export default router;
