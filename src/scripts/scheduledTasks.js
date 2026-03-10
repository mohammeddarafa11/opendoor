import cron from "node-cron";
import Reservation from "../db/models/Reservation.model.js";
import Payment from "../db/models/payment.model.js";
import Waitlist from "../db/models/waitlist.model.js";
import Unit from "../db/models/unit.model.js";
import User from "../db/models/User.model.js";
import ActivityLog from "../db/models/ActivityLog.model.js";
import { sendEmail } from "../config/emailService.js";

// ==================== 1. RESERVATION AUTO-EXPIRY ====================
// Runs every 30 minutes
// Pending reservations expire after 24 hours if no payment made

const expireReservations = async () => {
  try {
    const expiredReservations = await Reservation.find({
      status: "pending",
      expires_at: { $lt: new Date() },
    }).populate("unit", "unit_number _id");

    if (expiredReservations.length === 0) return;

    console.log(
      `⏰ Found ${expiredReservations.length} expired reservation(s)`,
    );

    for (const reservation of expiredReservations) {
      // Check if any payment was actually made
      const paymentExists = await Payment.findOne({
        reservation: reservation._id,
        status: "completed",
      });

      // If they paid, don't expire - confirm instead
      if (paymentExists) {
        reservation.status = "confirmed";
        reservation.confirmed_at = new Date();
        await reservation.save();
        console.log(
          `✅ Reservation ${reservation.reservation_number} auto-confirmed (payment found)`,
        );
        continue;
      }

      // No payment — expire the reservation
      reservation.status = "expired";
      reservation.cancelled_at = new Date();
      reservation.cancellation_reason =
        "Auto-expired: no payment within 24 hours";
      await reservation.save();

      // Release unit back to available
      if (reservation.unit) {
        await Unit.findByIdAndUpdate(reservation.unit._id, {
          status: "available",
        });
      }

      // Log activity
      await ActivityLog.create({
        action: "reservation_expired",
        details: `Reservation ${reservation.reservation_number} auto-expired (no payment)`,
        target_type: "Reservation",
        target_id: reservation._id,
      });

      // Notify customer about expiry
      try {
        const customer = await User.findById(reservation.user);
        if (customer) {
          await sendEmail({
            to: customer.email,
            subject: `⚠️ Reservation Expired - ${reservation.reservation_number}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #d32f2f;">Reservation Expired</h2>
                <p>Dear ${customer.name},</p>
                <p>Your reservation <strong>${reservation.reservation_number}</strong> for unit 
                   <strong>${reservation.unit?.unit_number || "N/A"}</strong> has expired because 
                   no payment was received within 24 hours.</p>
                <p>If you're still interested, the unit may be available for a new reservation.</p>
                <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/units/${reservation.unit?._id}" 
                   style="display: inline-block; padding: 12px 24px; background: #1976d2; color: white; 
                          text-decoration: none; border-radius: 4px; margin-top: 16px;">
                  View Unit
                </a>
                <p style="margin-top: 20px;">Best regards,<br>K Developments Team<br>📞 19844</p>
              </div>
            `,
          });
        }
      } catch (emailErr) {
        console.error(
          `📧 Failed to send expiry email for ${reservation.reservation_number}:`,
          emailErr.message,
        );
      }

      // Notify first person on the waitlist for this unit
      if (reservation.unit) {
        await notifyNextWaitlistPerson(
          reservation.unit._id,
          reservation.unit.unit_number,
        );
      }

      console.log(`❌ Reservation ${reservation.reservation_number} expired`);
    }
  } catch (error) {
    console.error("❌ Reservation expiry job error:", error.message);
  }
};

// ==================== 2. WAITLIST NOTIFICATION EXPIRY ====================
// Runs every hour
// If notified person doesn't reserve within 24h, notify next person

const expireWaitlistNotifications = async () => {
  try {
    const expiredEntries = await Waitlist.find({
      status: "notified",
      expires_at: { $lt: new Date() },
    }).populate("user", "name email");

    if (expiredEntries.length === 0) return;

    console.log(
      `⏰ Found ${expiredEntries.length} expired waitlist notification(s)`,
    );

    for (const entry of expiredEntries) {
      // Mark this entry as expired
      entry.status = "expired";
      entry.expired_at = new Date();
      await entry.save();

      console.log(
        `⏰ Waitlist expired for ${entry.user?.name || "Unknown"} on unit ${entry.unit}`,
      );

      // Send expiry notification to the person who missed out
      try {
        if (entry.user?.email) {
          await sendEmail({
            to: entry.user.email,
            subject: "Reservation Opportunity Expired",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #f57c00;">Opportunity Expired</h2>
                <p>Dear ${entry.user.name},</p>
                <p>Your 24-hour window to reserve the unit has expired.</p>
                <p>The opportunity has been passed to the next person on the waiting list.</p>
                <p>You can still browse other available units on our website.</p>
                <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/units" 
                   style="display: inline-block; padding: 12px 24px; background: #1976d2; color: white; 
                          text-decoration: none; border-radius: 4px; margin-top: 16px;">
                  Browse Units
                </a>
                <p style="margin-top: 20px;">Best regards,<br>K Developments Team<br>📞 19844</p>
              </div>
            `,
          });
        }
      } catch (emailErr) {
        console.error(
          `📧 Failed to send waitlist expiry email:`,
          emailErr.message,
        );
      }

      // Log activity
      await ActivityLog.create({
        user: entry.user?._id,
        action: "waitlist_expired",
        details: `Waitlist notification expired for unit ${entry.unit}`,
        target_type: "Waitlist",
        target_id: entry._id,
      });

      // Get the unit number for email template
      const unit = await Unit.findById(entry.unit).select("unit_number");

      // Notify the NEXT person in line
      await notifyNextWaitlistPerson(entry.unit, unit?.unit_number || "N/A");
    }
  } catch (error) {
    console.error("❌ Waitlist expiry job error:", error.message);
  }
};

// ==================== 3. PAYMENT REMINDERS ====================
// Runs every day at 9 AM Egypt time (UTC+2 = 7 AM UTC)
// Sends reminders: 7 days before, 1 day before, on due date, 1 day after

const sendPaymentReminders = async () => {
  try {
    // Get all confirmed reservations with their users
    const activeReservations = await Reservation.find({
      status: "confirmed",
    })
      .populate("user", "name email phone")
      .populate("unit", "unit_number");

    if (activeReservations.length === 0) return;

    console.log(
      `💰 Checking payment reminders for ${activeReservations.length} reservation(s)`,
    );

    let remindersSent = 0;

    for (const reservation of activeReservations) {
      if (!reservation.user?.email) continue;

      // Count completed payments for this reservation
      const completedPayments = await Payment.countDocuments({
        reservation: reservation._id,
        status: "completed",
      });

      // Determine what the next payment is
      let nextAmount;
      let paymentLabel;
      let nextDueDate = new Date(reservation.createdAt);

      if (completedPayments === 0) {
        // Reservation fee not yet paid
        nextAmount = reservation.reservation_fee;
        paymentLabel = "Reservation Fee";
        // Due immediately (within 24h of creation)
        nextDueDate = new Date(reservation.createdAt);
        nextDueDate.setDate(nextDueDate.getDate() + 1);
      } else if (completedPayments === 1) {
        // Down payment due next
        nextAmount = reservation.down_payment;
        paymentLabel = "Down Payment";
        nextDueDate.setMonth(nextDueDate.getMonth() + 1);
      } else {
        // Monthly installments
        const installmentNumber = completedPayments - 1;
        nextAmount = reservation.installment_plan.monthly_amount;
        paymentLabel = `Installment #${installmentNumber}`;
        nextDueDate.setMonth(nextDueDate.getMonth() + completedPayments);
      }

      // Check if all payments are done
      const totalPayments = reservation.installment_plan.duration_months + 2; // +2 for reservation fee and down payment
      if (completedPayments >= totalPayments) continue;

      // Calculate days until due
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const dueNormalized = new Date(nextDueDate);
      dueNormalized.setHours(0, 0, 0, 0);
      const daysUntilDue = Math.ceil(
        (dueNormalized - now) / (1000 * 60 * 60 * 24),
      );

      // Determine if we should send a reminder today
      let subject = null;
      let urgencyColor = "#1976d2"; // blue
      let urgencyText = "";

      if (daysUntilDue === 7) {
        subject = `📅 Payment Reminder - ${paymentLabel} due in 7 days`;
        urgencyText = `is due in <strong>7 days</strong> on ${nextDueDate.toLocaleDateString("en-GB")}`;
      } else if (daysUntilDue === 1) {
        subject = `⏰ Payment Due Tomorrow - ${paymentLabel}`;
        urgencyText = `is due <strong>tomorrow</strong> (${nextDueDate.toLocaleDateString("en-GB")})`;
        urgencyColor = "#f57c00"; // orange
      } else if (daysUntilDue === 0) {
        subject = `💳 Payment Due Today - ${paymentLabel}`;
        urgencyText = `is due <strong>today</strong>`;
        urgencyColor = "#f57c00"; // orange
      } else if (daysUntilDue === -1) {
        subject = `⚠️ OVERDUE Payment - ${paymentLabel}`;
        urgencyText = `was due <strong>yesterday</strong> and is now overdue`;
        urgencyColor = "#d32f2f"; // red
      }

      // Only send if it matches one of our reminder intervals
      if (!subject) continue;

      try {
        await sendEmail({
          to: reservation.user.email,
          subject,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: ${urgencyColor}; color: white; padding: 16px; border-radius: 8px 8px 0 0; text-align: center;">
                <h2 style="margin: 0;">Payment Reminder</h2>
              </div>
              <div style="border: 1px solid #e0e0e0; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
                <p>Dear ${reservation.user.name},</p>
                <p>Your <strong>${paymentLabel}</strong> of <strong>${nextAmount.toLocaleString()} EGP</strong> 
                   ${urgencyText}.</p>
                
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; background: #f5f5f5;"><strong>Reservation #</strong></td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">${reservation.reservation_number}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; background: #f5f5f5;"><strong>Unit</strong></td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">${reservation.unit?.unit_number || "N/A"}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; background: #f5f5f5;"><strong>Payment</strong></td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">${paymentLabel}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; background: #f5f5f5;"><strong>Amount</strong></td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; font-weight: bold; color: ${urgencyColor};">
                      ${nextAmount.toLocaleString()} EGP
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; background: #f5f5f5;"><strong>Due Date</strong></td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">${nextDueDate.toLocaleDateString("en-GB")}</td>
                  </tr>
                </table>

                <div style="text-align: center; margin-top: 24px;">
                  <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/dashboard" 
                     style="display: inline-block; padding: 14px 32px; background: ${urgencyColor}; color: white; 
                            text-decoration: none; border-radius: 4px; font-size: 16px; font-weight: bold;">
                    Pay Now
                  </a>
                </div>

                <p style="margin-top: 24px; color: #757575; font-size: 14px;">
                  If you've already made this payment, please disregard this reminder.
                </p>
                <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
                <p style="color: #757575; font-size: 13px;">
                  Best regards,<br>
                  K Developments Team<br>
                  📞 19844
                </p>
              </div>
            </div>
          `,
        });

        remindersSent++;
        console.log(
          `📧 Reminder sent to ${reservation.user.email}: ${paymentLabel} (${daysUntilDue} days)`,
        );
      } catch (emailErr) {
        console.error(
          `📧 Failed to send payment reminder to ${reservation.user.email}:`,
          emailErr.message,
        );
      }
    }

    console.log(`💰 Payment reminders complete: ${remindersSent} sent`);
  } catch (error) {
    console.error("❌ Payment reminder job error:", error.message);
  }
};

// ==================== 4. DAILY MANAGER SUMMARY ====================
// Runs every day at 9 AM
// Spec Section 9C1: "Yesterday: X reservations, Y EGP revenue"

const sendDailyManagerSummary = async () => {
  try {
    // Get all managers and admins
    const managers = await User.find({
      role: { $in: ["manager", "admin"] },
      is_active: true,
    }).select("name email");

    if (managers.length === 0) return;

    // Yesterday's date range
    const yesterdayStart = new Date();
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);

    const yesterdayEnd = new Date();
    yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
    yesterdayEnd.setHours(23, 59, 59, 999);

    // Get yesterday's stats
    const [
      newReservations,
      completedPayments,
      newWaitlistEntries,
      newCustomers,
    ] = await Promise.all([
      Reservation.countDocuments({
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      }),
      Payment.find({
        status: "completed",
        paid_at: { $gte: yesterdayStart, $lte: yesterdayEnd },
      }),
      Waitlist.countDocuments({
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      }),
      User.countDocuments({
        role: "customer",
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      }),
    ]);

    const totalRevenue = completedPayments.reduce(
      (sum, p) => sum + p.amount,
      0,
    );

    // Get current inventory
    const unitStats = await Unit.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const inventory = { available: 0, reserved: 0, sold: 0 };
    unitStats.forEach((s) => {
      if (inventory.hasOwnProperty(s._id)) {
        inventory[s._id] = s.count;
      }
    });

    // Pending actions
    const pendingReservations = await Reservation.countDocuments({
      status: "pending",
    });

    const overduePayments = await Payment.countDocuments({
      status: "pending",
      due_date: { $lt: new Date() },
    });

    // Low inventory alerts
    const lowInventoryBlocks = await Unit.aggregate([
      { $match: { status: "available" } },
      { $group: { _id: "$block", count: { $sum: 1 } } },
      { $match: { count: { $lte: 5 } } },
    ]);

    // Send to each manager
    for (const manager of managers) {
      try {
        await sendEmail({
          to: manager.email,
          subject: `📊 Daily Summary - ${yesterdayStart.toLocaleDateString("en-GB")}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: #1565c0; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                <h2 style="margin: 0;">📊 Daily Summary</h2>
                <p style="margin: 8px 0 0; opacity: 0.9;">${yesterdayStart.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
              </div>
              <div style="border: 1px solid #e0e0e0; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
                <p>Good morning, ${manager.name}!</p>
                
                <h3 style="color: #1565c0; border-bottom: 2px solid #1565c0; padding-bottom: 8px;">Yesterday's Activity</h3>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">🏠 New Reservations</td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; font-weight: bold; text-align: right;">${newReservations}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">💰 Revenue Collected</td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; font-weight: bold; text-align: right; color: #2e7d32;">
                      ${totalRevenue.toLocaleString()} EGP
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">💳 Payments Received</td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; font-weight: bold; text-align: right;">${completedPayments.length}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">👤 New Customers</td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; font-weight: bold; text-align: right;">${newCustomers}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">📋 Waitlist Joins</td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; font-weight: bold; text-align: right;">${newWaitlistEntries}</td>
                  </tr>
                </table>

                <h3 style="color: #1565c0; border-bottom: 2px solid #1565c0; padding-bottom: 8px;">Current Inventory</h3>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">🟢 Available</td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; font-weight: bold; text-align: right;">${inventory.available}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">🟡 Reserved</td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; font-weight: bold; text-align: right;">${inventory.reserved}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #e0e0e0;">🔴 Sold</td>
                    <td style="padding: 10px; border: 1px solid #e0e0e0; font-weight: bold; text-align: right;">${inventory.sold}</td>
                  </tr>
                </table>

                ${
                  pendingReservations > 0 || overduePayments > 0
                    ? `
                <h3 style="color: #d32f2f; border-bottom: 2px solid #d32f2f; padding-bottom: 8px;">⚠️ Action Required</h3>
                <ul style="padding-left: 20px;">
                  ${pendingReservations > 0 ? `<li><strong>${pendingReservations}</strong> reservations pending approval</li>` : ""}
                  ${overduePayments > 0 ? `<li style="color: #d32f2f;"><strong>${overduePayments}</strong> overdue payments</li>` : ""}
                  ${lowInventoryBlocks.length > 0 ? `<li><strong>${lowInventoryBlocks.length}</strong> building(s) with 5 or fewer units available</li>` : ""}
                </ul>
                `
                    : ""
                }

                <div style="text-align: center; margin-top: 24px;">
                  <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/dashboard" 
                     style="display: inline-block; padding: 14px 32px; background: #1565c0; color: white; 
                            text-decoration: none; border-radius: 4px; font-size: 16px;">
                    Open Dashboard
                  </a>
                </div>

                <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
                <p style="color: #757575; font-size: 13px;">
                  K Developments Platform<br>📞 19844
                </p>
              </div>
            </div>
          `,
        });

        console.log(`📊 Daily summary sent to ${manager.email}`);
      } catch (emailErr) {
        console.error(
          `📧 Failed to send daily summary to ${manager.email}:`,
          emailErr.message,
        );
      }
    }
  } catch (error) {
    console.error("❌ Daily summary job error:", error.message);
  }
};

// ==================== HELPER: NOTIFY NEXT WAITLIST PERSON ====================

const notifyNextWaitlistPerson = async (unitId, unitNumber) => {
  try {
    const nextInLine = await Waitlist.findOne({
      unit: unitId,
      status: "active",
    })
      .sort({ position: 1 })
      .populate("user", "name email phone");

    if (!nextInLine) {
      console.log(`📋 No one on waitlist for unit ${unitNumber || unitId}`);
      return null;
    }

    // Update waitlist entry
    nextInLine.status = "notified";
    nextInLine.notified_at = new Date();
    nextInLine.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await nextInLine.save();

    // Log activity
    await ActivityLog.create({
      user: nextInLine.user._id,
      action: "waitlist_notified",
      details: `Notified about unit ${unitNumber || unitId} availability. 24 hours to reserve.`,
      target_type: "Waitlist",
      target_id: nextInLine._id,
    });

    // Send notification email
    try {
      await sendEmail({
        to: nextInLine.user.email,
        subject: `🎉 Great News! Unit ${unitNumber} is now available!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #2e7d32; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="margin: 0;">🎉 Great News!</h1>
              <p style="margin: 8px 0 0; font-size: 18px;">A unit you wanted is now available!</p>
            </div>
            <div style="border: 1px solid #e0e0e0; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
              <p>Dear ${nextInLine.user.name},</p>
              <p>Unit <strong>${unitNumber}</strong> is now available for reservation!</p>
              
              <div style="background: #fff3e0; border-left: 4px solid #f57c00; padding: 16px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; font-weight: bold; color: #e65100;">
                  ⏰ You have 24 hours to reserve this unit!
                </p>
                <p style="margin: 8px 0 0; color: #e65100;">
                  After 24 hours, the opportunity passes to the next person on the waiting list.
                </p>
              </div>

              <div style="text-align: center; margin: 24px 0;">
                <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/units/${unitId}" 
                   style="display: inline-block; padding: 16px 40px; background: #2e7d32; color: white; 
                          text-decoration: none; border-radius: 4px; font-size: 18px; font-weight: bold;">
                  Reserve Now →
                </a>
              </div>

              <p style="color: #757575; font-size: 14px;">
                Don't miss this opportunity! Click the button above to reserve your unit.
              </p>
              <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
              <p style="color: #757575; font-size: 13px;">
                Best regards,<br>
                K Developments Team<br>
                📞 19844
              </p>
            </div>
          </div>
        `,
      });

      await ActivityLog.create({
        action: "email_sent",
        details: `Waitlist notification email sent to ${nextInLine.user.email} for unit ${unitNumber}`,
        target_type: "Waitlist",
        target_id: nextInLine._id,
        user: nextInLine.user._id,
      });
    } catch (emailErr) {
      console.error(
        `📧 Failed to send waitlist notification to ${nextInLine.user.email}:`,
        emailErr.message,
      );
    }

    console.log(
      `📧 Waitlist: Notified ${nextInLine.user.name} about unit ${unitNumber}`,
    );

    return nextInLine;
  } catch (error) {
    console.error("❌ Notify next waitlist person error:", error.message);
    return null;
  }
};

// ==================== 5. LOW INVENTORY ALERT ====================
// Runs every day at 10 AM
// Spec Section 9C2: "Only X units left in Building Y"

const checkLowInventory = async () => {
  try {
    const LOW_THRESHOLD = 5;

    // Group available units by block
    const blockInventory = await Unit.aggregate([
      { $match: { status: "available" } },
      {
        $group: {
          _id: "$block",
          available_count: { $sum: 1 },
        },
      },
      { $match: { available_count: { $lte: LOW_THRESHOLD } } },
      {
        $lookup: {
          from: "blocks",
          localField: "_id",
          foreignField: "_id",
          as: "block_info",
        },
      },
      { $unwind: { path: "$block_info", preserveNullAndEmptyArrays: true } },
    ]);

    if (blockInventory.length === 0) return;

    // Get managers
    const managers = await User.find({
      role: { $in: ["manager", "admin"] },
      is_active: true,
    }).select("name email");

    const alertRows = blockInventory
      .map(
        (b) =>
          `<tr>
            <td style="padding: 10px; border: 1px solid #e0e0e0;">${b.block_info?.name || "Unassigned"}</td>
            <td style="padding: 10px; border: 1px solid #e0e0e0; font-weight: bold; color: ${b.available_count <= 2 ? "#d32f2f" : "#f57c00"};">
              ${b.available_count} units
            </td>
          </tr>`,
      )
      .join("");

    for (const manager of managers) {
      try {
        await sendEmail({
          to: manager.email,
          subject: `⚠️ Low Inventory Alert - ${blockInventory.length} building(s)`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: #f57c00; color: white; padding: 16px; border-radius: 8px 8px 0 0; text-align: center;">
                <h2 style="margin: 0;">⚠️ Low Inventory Alert</h2>
              </div>
              <div style="border: 1px solid #e0e0e0; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
                <p>The following buildings have ${LOW_THRESHOLD} or fewer units available:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                  <tr style="background: #f5f5f5;">
                    <th style="padding: 10px; border: 1px solid #e0e0e0; text-align: left;">Building</th>
                    <th style="padding: 10px; border: 1px solid #e0e0e0; text-align: left;">Available Units</th>
                  </tr>
                  ${alertRows}
                </table>
                <div style="text-align: center; margin-top: 20px;">
                  <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/dashboard" 
                     style="display: inline-block; padding: 12px 24px; background: #1565c0; color: white; 
                            text-decoration: none; border-radius: 4px;">
                    View Dashboard
                  </a>
                </div>
                <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
                <p style="color: #757575; font-size: 13px;">K Developments Platform<br>📞 19844</p>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error(
          `📧 Failed to send low inventory alert to ${manager.email}:`,
          emailErr.message,
        );
      }
    }

    console.log(
      `⚠️ Low inventory alert sent for ${blockInventory.length} building(s)`,
    );
  } catch (error) {
    console.error("❌ Low inventory check error:", error.message);
  }
};

// ==================== START ALL SCHEDULED TASKS ====================

export const startScheduledTasks = () => {
  // Every 30 minutes: check reservation expiry
  cron.schedule("*/30 * * * *", () => {
    console.log("⏰ [CRON] Running reservation expiry check...");
    expireReservations();
  });

  // Every hour: check waitlist notification expiry
  cron.schedule("0 * * * *", () => {
    console.log("⏰ [CRON] Running waitlist expiry check...");
    expireWaitlistNotifications();
  });

  // Every day at 9 AM Egypt time (UTC+2 = 7 AM UTC)
  cron.schedule("0 7 * * *", () => {
    console.log("⏰ [CRON] Running payment reminders...");
    sendPaymentReminders();
  });

  // Every day at 9 AM Egypt time — daily manager summary
  cron.schedule("5 7 * * *", () => {
    console.log("⏰ [CRON] Running daily manager summary...");
    sendDailyManagerSummary();
  });

  // Every day at 10 AM Egypt time (8 AM UTC) — low inventory check
  cron.schedule("0 8 * * *", () => {
    console.log("⏰ [CRON] Running low inventory check...");
    checkLowInventory();
  });

  console.log("✅ Scheduled tasks registered:");
  console.log("   📌 Reservation expiry:     every 30 min");
  console.log("   📌 Waitlist expiry:         every hour");
  console.log("   📌 Payment reminders:       daily at 9:00 AM EET");
  console.log("   📌 Manager daily summary:   daily at 9:05 AM EET");
  console.log("   📌 Low inventory alert:     daily at 10:00 AM EET");
};

// Export helper for use in other files (e.g., reservationRoutes)
export { notifyNextWaitlistPerson };
