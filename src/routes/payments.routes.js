import express from "express";
import Payment from "../db/models/payment.model.js";
import Reservation from "../db/models/Reservation.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import {
  validate,
  createPaymentSchema,
} from "../middleware/validation.middleware.js";

const router = express.Router();

// Create payment (customer)
router.post(
  "/",
  authMiddleware,
  validate(createPaymentSchema),
  async (req, res) => {
    try {
      const {
        reservation: reservationId,
        amount,
        payment_method,
        notes,
      } = req.body;

      // Verify reservation belongs to user
      const reservation = await Reservation.findById(reservationId);
      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      if (
        req.user.role === "customer" &&
        reservation.user.toString() !== req.userId
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (reservation.status === "cancelled") {
        return res
          .status(400)
          .json({ message: "Cannot pay for a cancelled reservation" });
      }

      // Determine payment type
      let payment_type = "installment";
      const existingPayments = await Payment.find({
        reservation: reservationId,
        status: "completed",
      });

      if (existingPayments.length === 0) {
        payment_type = "reservation_fee";
      } else if (existingPayments.length === 1) {
        payment_type = "down_payment";
      }

      const payment = new Payment({
        reservation: reservationId,
        user: req.userId,
        amount,
        payment_type,
        payment_method,
        notes,
        status: payment_method === "bank_transfer" ? "pending" : "pending",
      });

      await payment.save();

      // For bank transfer, payment stays pending until manually verified
      // For other methods, we would integrate with Paymob here

      await payment.populate("reservation", "reservation_number unit");

      res.status(201).json({
        message: "Payment created",
        payment,
        // In production, this would be a Paymob redirect URL
        payment_url:
          payment_method !== "bank_transfer"
            ? `https://accept.paymob.com/api/acceptance/iframes/${process.env.PAYMOB_IFRAME_ID}?payment_token=TOKEN`
            : null,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Paymob webhook (callback after payment)
router.post("/webhook/paymob", async (req, res) => {
  try {
    const { obj } = req.body;

    if (!obj || !obj.order || !obj.id) {
      return res.status(400).json({ message: "Invalid webhook data" });
    }

    // TODO: Verify HMAC signature from Paymob for security
    // const hmac = req.query.hmac;
    // const isValid = verifyPaymobHMAC(obj, hmac);

    const payment = await Payment.findOne({
      paymob_order_id: obj.order.id.toString(),
    });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (obj.success === true) {
      payment.status = "completed";
      payment.transaction_id = obj.id.toString();
      payment.paid_at = new Date();
      await payment.save();

      // Update reservation status if reservation fee paid
      if (payment.payment_type === "reservation_fee") {
        await Reservation.findByIdAndUpdate(payment.reservation, {
          status: "confirmed",
          confirmed_at: new Date(),
        });
      }
    } else {
      payment.status = "failed";
      await payment.save();
    }

    res.status(200).json({ message: "Webhook processed" });
  } catch (error) {
    console.error("Paymob webhook error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get my payments (customer)
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const payments = await Payment.find({ user: req.userId })
      .populate({
        path: "reservation",
        select: "reservation_number unit status",
        populate: {
          path: "unit",
          select: "unit_number property_type price",
        },
      })
      .sort({ createdAt: -1 });

    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get payments for a reservation
router.get("/reservation/:reservationId", authMiddleware, async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.reservationId);

    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found" });
    }

    // Customers can only see their own payments
    if (
      req.user.role === "customer" &&
      reservation.user.toString() !== req.userId
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    const payments = await Payment.find({
      reservation: req.params.reservationId,
    }).sort({ createdAt: -1 });

    const totalPaid = payments
      .filter((p) => p.status === "completed")
      .reduce((sum, p) => sum + p.amount, 0);

    res.json({
      payments,
      summary: {
        total_price: reservation.total_price,
        total_paid: totalPaid,
        remaining: reservation.total_price - totalPaid,
        payment_count: payments.length,
        completed_count: payments.filter((p) => p.status === "completed")
          .length,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all payments (manager/admin)
router.get(
  "/",
  authMiddleware,
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const { status, payment_method, page = 1, limit = 20 } = req.query;

      let filter = {};
      if (status) filter.status = status;
      if (payment_method) filter.payment_method = payment_method;

      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
      const skip = (pageNum - 1) * limitNum;

      const [payments, total] = await Promise.all([
        Payment.find(filter)
          .populate("user", "name email phone")
          .populate({
            path: "reservation",
            select: "reservation_number unit",
            populate: { path: "unit", select: "unit_number" },
          })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        Payment.countDocuments(filter),
      ]);

      res.json({
        payments,
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
  },
);

// Verify bank transfer payment (manager/admin)
router.patch(
  "/:id/verify",
  authMiddleware,
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const payment = await Payment.findById(req.params.id);

      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      if (payment.status !== "pending") {
        return res
          .status(400)
          .json({ message: `Payment is already ${payment.status}` });
      }

      payment.status = "completed";
      payment.paid_at = new Date();
      payment.notes = `${payment.notes || ""} | Verified by ${req.user.name}`;
      await payment.save();

      // Update reservation if needed
      if (payment.payment_type === "reservation_fee") {
        await Reservation.findByIdAndUpdate(payment.reservation, {
          status: "confirmed",
          confirmed_at: new Date(),
        });
      }

      res.json({ message: "Payment verified", payment });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Refund payment (admin only)
router.patch(
  "/:id/refund",
  authMiddleware,
  authorize("admin"),
  async (req, res) => {
    try {
      const payment = await Payment.findById(req.params.id);

      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      if (payment.status !== "completed") {
        return res
          .status(400)
          .json({ message: "Only completed payments can be refunded" });
      }

      payment.status = "refunded";
      payment.notes = `${payment.notes || ""} | Refunded by ${req.user.name} on ${new Date().toISOString()}`;
      await payment.save();

      res.json({ message: "Payment refunded", payment });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

export default router;
