import nodemailer from "nodemailer";
import { EventEmitter } from "events";
import dotenv from "dotenv";

dotenv.config();

// Event Emitter للتعامل مع الـ Wishlist و Waiting List
export const notificationEmitter = new EventEmitter();

// إعداد Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// دالة إرسال البريد الإلكتروني
export const sendEmail = async (to, subject, html) => {
  try {
    const info = await transporter.sendMail({
      from: `"K Developments" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });

    console.log("✅ Email sent:", info.messageId);
    return info;
  } catch (error) {
    console.error("❌ Email error:", error);
    throw error;
  }
};

// Event listener for OTP
notificationEmitter.on("otp:send", async (data) => {
  const { email, userName, otp } = data;
  const subject = "Verify Your Account - K Developments";
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f9fafb;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2 style="color: #1e40af;">Hello ${userName}!</h2>
        <p>Thank you for creating an account with K Developments.</p>
        <p>Your verification code is:</p>
        <div style="background-color: #eff6ff; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <h1 style="color: #1e40af; font-size: 36px; margin: 0; letter-spacing: 8px;">${otp}</h1>
        </div>
        <p style="color: #6b7280;">This code will expire in 10 minutes.</p>
        <br>
        <p>Best regards,<br>K Developments Team</p>
      </div>
    </div>
  `;
  await sendEmail(email, subject, html);
});

// Event listener for reservation created
notificationEmitter.on("reservation:created", async (data) => {
  const {
    email,
    userName,
    unitNumber,
    projectName,
    price,
    agentName,
    agentPhone,
    reservationId,
  } = data;
  const subject = "Reservation Confirmed - K Developments";
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f9fafb;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 10px;">
        <h2 style="color: #059669;">🎉 Reservation Confirmed!</h2>
        <p>Hello ${userName},</p>
        <p>Congratulations! Your reservation has been confirmed.</p>
        
        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Reservation Details:</h3>
          <p><strong>Reservation ID:</strong> #${reservationId}</p>
          <p><strong>Project:</strong> ${projectName}</p>
          <p><strong>Unit:</strong> ${unitNumber}</p>
          <p><strong>Price:</strong> ${price ? price.toLocaleString() : "N/A"} EGP</p>
        </div>

        <div style="background-color: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Your Dedicated Agent:</h3>
          <p><strong>Name:</strong> ${agentName || "Will be assigned"}</p>
          <p><strong>Phone:</strong> ${agentPhone || "Will be provided"}</p>
          <p>Your agent will contact you within 24 hours to complete the process.</p>
        </div>

        <p><strong>Next Steps:</strong></p>
        <ol>
          <li>Wait for your agent to contact you</li>
          <li>Prepare required documents (ID, proof of income)</li>
          <li>Complete payment process</li>
        </ol>

        <p>Best regards,<br>K Developments Team</p>
      </div>
    </div>
  `;
  await sendEmail(email, subject, html);
});

// Event listeners للـ Wishlist
notificationEmitter.on("wishlist:added", async (data) => {
  const { email, unitNumber, userName } = data;
  const subject = "Added to Wishlist - K Developments";
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2>Hello ${userName}!</h2>
      <p>You've added <strong>Unit ${unitNumber}</strong> to your wishlist.</p>
      <p>We'll notify you if there are any updates about this unit.</p>
      <br>
      <p>Best regards,<br>K Developments Team</p>
    </div>
  `;
  await sendEmail(email, subject, html);
});

// Event listeners للـ Waiting List
notificationEmitter.on("waitlist:added", async (data) => {
  const { email, unitNumber, userName, position } = data;
  const subject = "You're on the Waiting List! - K Developments";
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2>Hello ${userName}!</h2>
      <p>You've been added to the waiting list for <strong>Unit ${unitNumber}</strong>.</p>
      <p>Your position: <strong>#${position}</strong></p>
      <p>We'll notify you immediately when this unit becomes available.</p>
      <br>
      <p>Best regards,<br>K Developments Team</p>
    </div>
  `;
  await sendEmail(email, subject, html);
});

notificationEmitter.on("waitlist:available", async (data) => {
  const { email, unitNumber, userName } = data;
  const subject = "Unit Now Available! - K Developments";
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f0f9ff; border-left: 4px solid #3b82f6;">
      <h2 style="color: #1e40af;">Great News, ${userName}!</h2>
      <p><strong>Unit ${unitNumber}</strong> is now available for reservation!</p>
      <p>You have <strong>24 hours</strong> to reserve this unit before it goes to the next person.</p>
      <a href="http://localhost:3000/units/${unitNumber}" 
         style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 8px; margin-top: 16px;">
        Reserve Now
      </a>
      <br><br>
      <p>Best regards,<br>K Developments Team</p>
    </div>
  `;
  await sendEmail(email, subject, html);
});

// Remove the duplicate export line at the bottom
