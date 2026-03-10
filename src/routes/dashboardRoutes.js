import express from "express";
import Unit from "../db/models/unit.model.js";
import Reservation from "../db/models/Reservation.model.js";
import Payment from "../db/models/payment.model.js";
import User from "../db/models/User.model.js";
import Waitlist from "../db/models/waitlist.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = express.Router();

router.use(authMiddleware);
// ADD THESE ROUTES:

// Stats endpoint (for frontend compatibility)
router.get("/stats", authorize("admin", "manager"), async (req, res) => {
  try {
    const [totalUnits, availableUnits, totalReservations, revenueData] =
      await Promise.all([
        Unit.countDocuments(),
        Unit.countDocuments({ status: "available" }),
        Reservation.countDocuments(),
        Payment.aggregate([
          { $match: { status: "completed" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
      ]);

    res.json({
      totalUnits,
      availableUnits,
      totalReservations,
      totalRevenue: revenueData[0]?.total || 0,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Manager stats (alias to overview)
router.get("/manager", authorize("admin", "manager"), async (req, res) => {
  try {
    // Reuse overview logic
    const overviewData = await req.app._router.stack
      .find((r) => r.route?.path === "/overview")
      ?.route.stack[0].handle(req, res);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// ==================== MANAGER/ADMIN DASHBOARD ====================

// Overview KPIs
router.get("/overview", authorize("admin", "manager"), async (req, res) => {
  try {
    const [
      totalUnits,
      unitsByStatus,
      totalReservations,
      revenueData,
      totalCustomers,
      totalAgents,
      waitlistCount,
    ] = await Promise.all([
      // Total units
      Unit.countDocuments(),

      // Units by status
      Unit.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),

      // Total reservations
      Reservation.countDocuments(),

      // Revenue from completed payments
      Payment.aggregate([
        { $match: { status: "completed" } },
        {
          $group: {
            _id: null,
            total_revenue: { $sum: "$amount" },
            total_payments: { $sum: 1 },
          },
        },
      ]),

      // Total customers
      User.countDocuments({ role: "customer" }),

      // Total agents
      User.countDocuments({ role: "agent" }),

      // People on waitlist
      Waitlist.countDocuments({ status: "active" }),
    ]);

    // Process units by status
    const statusMap = {};
    unitsByStatus.forEach((s) => {
      statusMap[s._id] = s.count;
    });

    // Recent activity
    const recentReservations = await Reservation.find()
      .populate("user", "name")
      .populate("unit", "unit_number")
      .sort({ createdAt: -1 })
      .limit(5);

    const recentPayments = await Payment.find({ status: "completed" })
      .populate("user", "name")
      .sort({ paid_at: -1 })
      .limit(5);

    res.json({
      kpis: {
        total_units: totalUnits,
        available_units: statusMap["available"] || 0,
        reserved_units: statusMap["reserved"] || 0,
        sold_units: statusMap["sold"] || 0,
        total_reservations: totalReservations,
        total_revenue: revenueData[0]?.total_revenue || 0,
        total_payments: revenueData[0]?.total_payments || 0,
        total_customers: totalCustomers,
        total_agents: totalAgents,
        people_on_waitlist: waitlistCount,
      },
      recent_reservations: recentReservations,
      recent_payments: recentPayments,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Sales report
router.get(
  "/reports/sales",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { start_date, end_date, group_by = "month" } = req.query;

      let matchFilter = { status: { $in: ["confirmed", "completed"] } };

      if (start_date || end_date) {
        matchFilter.createdAt = {};
        if (start_date) matchFilter.createdAt.$gte = new Date(start_date);
        if (end_date) matchFilter.createdAt.$lte = new Date(end_date);
      }

      let dateFormat;
      switch (group_by) {
        case "day":
          dateFormat = "%Y-%m-%d";
          break;
        case "week":
          dateFormat = "%Y-W%V";
          break;
        case "month":
        default:
          dateFormat = "%Y-%m";
          break;
      }

      const salesByPeriod = await Reservation.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: { $dateToString: { format: dateFormat, date: "$createdAt" } },
            units_sold: { $sum: 1 },
            total_revenue: { $sum: "$total_price" },
            avg_price: { $avg: "$total_price" },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      const salesByType = await Reservation.aggregate([
        { $match: matchFilter },
        {
          $lookup: {
            from: "units",
            localField: "unit",
            foreignField: "_id",
            as: "unit_info",
          },
        },
        { $unwind: "$unit_info" },
        {
          $group: {
            _id: "$unit_info.property_type",
            count: { $sum: 1 },
            revenue: { $sum: "$total_price" },
          },
        },
        { $sort: { count: -1 } },
      ]);

      const salesByAgent = await Reservation.aggregate([
        { $match: { ...matchFilter, assigned_agent: { $exists: true } } },
        {
          $group: {
            _id: "$assigned_agent",
            sales_count: { $sum: 1 },
            total_revenue: { $sum: "$total_price" },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "agent_info",
          },
        },
        { $unwind: "$agent_info" },
        {
          $project: {
            agent_name: "$agent_info.name",
            agent_email: "$agent_info.email",
            sales_count: 1,
            total_revenue: 1,
          },
        },
        { $sort: { sales_count: -1 } },
      ]);

      res.json({
        sales_by_period: salesByPeriod,
        sales_by_type: salesByType,
        sales_by_agent: salesByAgent,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Financial report
router.get(
  "/reports/financial",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { start_date, end_date } = req.query;

      let matchFilter = {};
      if (start_date || end_date) {
        matchFilter.createdAt = {};
        if (start_date) matchFilter.createdAt.$gte = new Date(start_date);
        if (end_date) matchFilter.createdAt.$lte = new Date(end_date);
      }

      const [
        revenueByType,
        revenueByMethod,
        pendingPayments,
        overdueReservations,
      ] = await Promise.all([
        // Revenue by payment type
        Payment.aggregate([
          { $match: { ...matchFilter, status: "completed" } },
          {
            $group: {
              _id: "$payment_type",
              total: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ]),

        // Revenue by payment method
        Payment.aggregate([
          { $match: { ...matchFilter, status: "completed" } },
          {
            $group: {
              _id: "$payment_method",
              total: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ]),

        // Pending payments
        Payment.aggregate([
          { $match: { status: "pending" } },
          {
            $group: {
              _id: null,
              total: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ]),

        // Overdue reservations (expired but not cancelled)
        Reservation.countDocuments({
          status: "pending",
          expires_at: { $lt: new Date() },
        }),
      ]);

      const totalRevenue = revenueByType.reduce((sum, r) => sum + r.total, 0);
      const totalPending = pendingPayments[0]?.total || 0;

      res.json({
        total_revenue: totalRevenue,
        total_pending: totalPending,
        overdue_reservations: overdueReservations,
        revenue_by_payment_type: revenueByType,
        revenue_by_method: revenueByMethod,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Inventory report
router.get(
  "/reports/inventory",
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const [byBuilding, byType, byStatus, priceRanges] = await Promise.all([
        // Units by building/block
        Unit.aggregate([
          {
            $lookup: {
              from: "blocks",
              localField: "block",
              foreignField: "_id",
              as: "block_info",
            },
          },
          {
            $group: {
              _id: "$block",
              block_name: { $first: { $arrayElemAt: ["$block_info.name", 0] } },
              total: { $sum: 1 },
              available: {
                $sum: { $cond: [{ $eq: ["$status", "available"] }, 1, 0] },
              },
              reserved: {
                $sum: { $cond: [{ $eq: ["$status", "reserved"] }, 1, 0] },
              },
              sold: {
                $sum: { $cond: [{ $eq: ["$status", "sold"] }, 1, 0] },
              },
              avg_price: { $avg: "$price" },
            },
          },
          { $sort: { block_name: 1 } },
        ]),

        // Units by type
        Unit.aggregate([
          {
            $group: {
              _id: "$property_type",
              total: { $sum: 1 },
              available: {
                $sum: { $cond: [{ $eq: ["$status", "available"] }, 1, 0] },
              },
              avg_price: { $avg: "$price" },
              min_price: { $min: "$price" },
              max_price: { $max: "$price" },
            },
          },
          { $sort: { total: -1 } },
        ]),

        // Overall status
        Unit.aggregate([
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ]),

        // Price distribution
        Unit.aggregate([
          {
            $bucket: {
              groupBy: "$price",
              boundaries: [
                0, 1000000, 2000000, 3000000, 4000000, 5000000, 10000000,
              ],
              default: "10000000+",
              output: {
                count: { $sum: 1 },
                available: {
                  $sum: { $cond: [{ $eq: ["$status", "available"] }, 1, 0] },
                },
              },
            },
          },
        ]),
      ]);

      res.json({
        by_building: byBuilding,
        by_type: byType,
        by_status: byStatus,
        price_distribution: priceRanges,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// ==================== AGENT DASHBOARD ====================

// Agent's own dashboard
router.get("/agent", authorize("agent"), async (req, res) => {
  try {
    const agent = await User.findById(req.userId).populate(
      "assigned_customers",
      "name email phone",
    );

    // Get agent's reservations
    const reservations = await Reservation.find({
      assigned_agent: req.userId,
    })
      .populate("user", "name email phone")
      .populate("unit", "unit_number property_type price")
      .sort({ createdAt: -1 });

    const confirmedCount = reservations.filter(
      (r) => r.status === "confirmed" || r.status === "completed",
    ).length;

    const totalRevenue = reservations
      .filter((r) => r.status === "confirmed" || r.status === "completed")
      .reduce((sum, r) => sum + r.total_price, 0);

    // Pending follow-ups (reservations that are pending)
    const pendingFollowUps = reservations.filter((r) => r.status === "pending");

    res.json({
      agent: {
        name: agent.name,
        email: agent.email,
        sales_target: agent.sales_target,
      },
      performance: {
        total_customers: agent.assigned_customers.length,
        total_reservations: reservations.length,
        confirmed_reservations: confirmedCount,
        total_revenue: totalRevenue,
        target_progress:
          agent.sales_target > 0
            ? Math.round((confirmedCount / agent.sales_target) * 100)
            : 0,
        conversion_rate:
          reservations.length > 0
            ? Math.round((confirmedCount / reservations.length) * 100)
            : 0,
      },
      customers: agent.assigned_customers,
      recent_reservations: reservations.slice(0, 10),
      pending_follow_ups: pendingFollowUps,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== CUSTOMER DASHBOARD ====================

// Customer's own dashboard
router.get("/customer", authorize("customer"), async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select("-password")
      .populate("assigned_agent", "name email phone");

    // Get reservations
    const reservations = await Reservation.find({ user: req.userId })
      .populate(
        "unit",
        "unit_number property_type price images area_sqm bedrooms bathrooms",
      )
      .populate("assigned_agent", "name email phone")
      .sort({ createdAt: -1 });

    // Get payments
    const payments = await Payment.find({
      user: req.userId,
      status: "completed",
    }).sort({ paid_at: -1 });

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    // Get waitlist entries
    const waitlistEntries = await Waitlist.find({
      user: req.userId,
      status: { $in: ["active", "notified"] },
    }).populate(
      "unit",
      "unit_number property_type price images area_sqm bedrooms bathrooms",
    );

    // Calculate next payment due
    let nextPaymentDue = null;
    const activeReservation = reservations.find(
      (r) => r.status === "confirmed",
    );
    if (activeReservation) {
      const paidCount = payments.filter(
        (p) => p.reservation?.toString() === activeReservation._id.toString(),
      ).length;

      if (paidCount < activeReservation.installment_plan.months + 2) {
        // +2 for reservation fee and down payment
        const nextDueDate = new Date(activeReservation.createdAt);
        nextDueDate.setMonth(nextDueDate.getMonth() + paidCount);

        let nextAmount = activeReservation.installment_plan.monthly_amount;
        if (paidCount === 0) nextAmount = 5000; // reservation fee
        if (paidCount === 1) nextAmount = activeReservation.down_payment; // down payment

        nextPaymentDue = {
          date: nextDueDate,
          amount: nextAmount,
          type:
            paidCount === 0
              ? "reservation_fee"
              : paidCount === 1
                ? "down_payment"
                : "installment",
        };
      }
    }

    res.json({
      user: {
        name: user.name,
        email: user.email,
        phone: user.phone,
        agent: user.assigned_agent,
      },
      reservations,
      payment_summary: {
        total_paid: totalPaid,
        payment_count: payments.length,
        recent_payments: payments.slice(0, 5),
        next_payment_due: nextPaymentDue,
      },
      waitlist: waitlistEntries,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
