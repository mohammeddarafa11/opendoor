import express from "express";
import User from "../db/models/User.model.js";
import Unit from "../db/models/unit.model.js";
import Reservation from "../db/models/Reservation.model.js";
import Payment from "../db/models/payment.model.js";
import Waitlist from "../db/models/waitlist.model.js";
import ActivityLog from "../db/models/ActivityLog.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = express.Router();

router.use(authMiddleware);

// ==================== USER MANAGEMENT ====================

// Get all users
router.get("/users", authorize("admin"), async (req, res) => {
  try {
    const { role, is_active, search, page = 1, limit = 20 } = req.query;

    let filter = {};
    if (role) filter.role = role;
    if (is_active !== undefined) filter.is_active = is_active === "true";
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(filter),
    ]);

    res.json({
      users,
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

// Get single user details
router.get("/users/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password")
      .populate("assigned_agent", "name email phone")
      .populate("assigned_customers", "name email phone");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const reservations = await Reservation.find({ user: req.params.id })
      .populate("unit", "unit_number property_type price")
      .sort({ createdAt: -1 });

    const payments = await Payment.find({
      user: req.params.id,
      status: "completed",
    });

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    // Get activity timeline
    const activities = await ActivityLog.find({
      $or: [{ user: req.params.id }, { target_id: req.params.id }],
    })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      user,
      reservations,
      payment_summary: {
        total_paid: totalPaid,
        payment_count: payments.length,
      },
      recent_activities: activities,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update user
router.put("/users/:id", authorize("admin"), async (req, res) => {
  try {
    const allowedUpdates = [
      "name",
      "phone",
      "role",
      "is_active",
      "sales_target",
    ];
    const updates = {};

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (req.params.id === req.userId && updates.role) {
      return res.status(400).json({ message: "Cannot change your own role" });
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "User updated", user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Suspend/Activate user
router.patch(
  "/users/:id/toggle-status",
  authorize("admin"),
  async (req, res) => {
    try {
      if (req.params.id === req.userId) {
        return res
          .status(400)
          .json({ message: "Cannot suspend your own account" });
      }

      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      user.is_active = !user.is_active;
      await user.save();

      // Log activity
      await ActivityLog.create({
        user: req.userId,
        action: user.is_active ? "user_activated" : "user_suspended",
        details: `${user.name} (${user.email}) ${user.is_active ? "activated" : "suspended"}`,
        target_type: "User",
        target_id: user._id,
      });

      res.json({
        message: `User ${user.is_active ? "activated" : "suspended"}`,
        user: {
          id: user._id,
          name: user.name,
          is_active: user.is_active,
        },
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Assign agent to customer
router.patch(
  "/users/:customerId/assign-agent",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { agentId } = req.body;

      const customer = await User.findById(req.params.customerId);
      if (!customer || customer.role !== "customer") {
        return res.status(400).json({ message: "Invalid customer" });
      }

      const agent = await User.findById(agentId);
      if (!agent || agent.role !== "agent") {
        return res.status(400).json({ message: "Invalid agent" });
      }

      customer.assigned_agent = agentId;
      await customer.save();

      await User.findByIdAndUpdate(agentId, {
        $addToSet: { assigned_customers: customer._id },
      });

      // Log activity
      await ActivityLog.create({
        user: req.userId,
        action: "agent_assigned",
        details: `Agent ${agent.name} assigned to customer ${customer.name}`,
        target_type: "User",
        target_id: customer._id,
      });

      res.json({
        message: `Agent ${agent.name} assigned to customer ${customer.name}`,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// ==================== AGENTS LIST ====================

router.get("/agents", authorize("admin", "manager"), async (req, res) => {
  try {
    const agents = await User.find({ role: "agent", is_active: true })
      .select("name email phone sales_target assigned_customers createdAt")
      .populate("assigned_customers", "name email phone");

    const agentData = await Promise.all(
      agents.map(async (agent) => {
        const reservations = await Reservation.find({
          assigned_agent: agent._id,
        });

        const confirmedReservations = reservations.filter(
          (r) => r.status === "confirmed" || r.status === "completed",
        );

        const totalRevenue = confirmedReservations.reduce(
          (sum, r) => sum + r.total_price,
          0,
        );

        return {
          ...agent.toObject(),
          performance: {
            total_customers: agent.assigned_customers.length,
            total_reservations: reservations.length,
            confirmed_reservations: confirmedReservations.length,
            total_revenue: totalRevenue,
            conversion_rate:
              reservations.length > 0
                ? Math.round(
                    (confirmedReservations.length / reservations.length) * 100,
                  )
                : 0,
            target_progress:
              agent.sales_target > 0
                ? Math.round(
                    (confirmedReservations.length / agent.sales_target) * 100,
                  )
                : 0,
          },
        };
      }),
    );

    res.json(agentData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== ACTIVITY LOGS (Spec Section 7C) ====================

router.get("/activity-logs", authorize("admin"), async (req, res) => {
  try {
    const { action, user, page = 1, limit = 50 } = req.query;

    let filter = {};
    if (action) filter.action = action;
    if (user) filter.user = user;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .populate("user", "name email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      ActivityLog.countDocuments(filter),
    ]);

    res.json({
      logs,
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

export default router;
