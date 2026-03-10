import Joi from "joi";

// Generic body validation middleware
export const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(400).json({ message: "Validation Error", errors });
    }

    req.body = value;
    next();
  };
};

// ============= AUTH SCHEMAS =============

export const registerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required().messages({
    "string.min": "Name must be at least 2 characters",
    "string.max": "Name must not exceed 50 characters",
    "any.required": "Name is required",
  }),
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email",
    "any.required": "Email is required",
  }),
  password: Joi.string().min(6).max(128).required().messages({
    "string.min": "Password must be at least 6 characters",
    "any.required": "Password is required",
  }),
  phone: Joi.string()
    .pattern(/^01[0125][0-9]{8}$/)
    .required()
    .messages({
      "string.pattern.base":
        "Please provide a valid Egyptian phone number (e.g., 01012345678)",
      "any.required": "Phone number is required",
    }),
  national_id: Joi.string()
    .pattern(/^[0-9]{14}$/)
    .allow(null, "")
    .messages({
      "string.pattern.base": "National ID must be 14 digits",
    }),
  address: Joi.string().max(200).allow(null, ""),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email",
    "any.required": "Email is required",
  }),
  password: Joi.string().required().messages({
    "any.required": "Password is required",
  }),
});

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().messages({
    "any.required": "Current password is required",
  }),
  newPassword: Joi.string().min(6).max(128).required().messages({
    "string.min": "New password must be at least 6 characters",
    "any.required": "New password is required",
  }),
});

export const createStaffSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).max(128).required(),
  phone: Joi.string()
    .pattern(/^01[0125][0-9]{8}$/)
    .required(),
  role: Joi.string().valid("agent", "manager").required().messages({
    "any.only": "Staff role must be 'agent' or 'manager'",
  }),
  sales_target: Joi.number().min(0).default(0),
});

// ============= UNIT SCHEMAS =============

export const createUnitSchema = Joi.object({
  unit_number: Joi.string().required(),
  project: Joi.string().required(),
  block: Joi.string().allow(null, ""),
  property_type: Joi.string()
    .valid(
      "Apartment",
      "Duplex",
      "Penthouse",
      "Studio",
      "Villa",
      "Townhouse",
      "Twin House",
      "Chalet",
    )
    .required(),
  bedrooms: Joi.number().min(0).max(20).required(),
  bathrooms: Joi.number().min(1).max(20).required(),
  area_sqm: Joi.number().min(10).max(10000).required(),
  price: Joi.number().min(0).required(),
  floor: Joi.number().min(-5).max(100).allow(null),
  view_type: Joi.string()
    .valid("street", "garden", "park", "pool", "sea", "city", "")
    .allow(null, ""),
  has_garden: Joi.boolean().default(false),
  garden_area: Joi.number().min(0).allow(null),
  balconies: Joi.number().min(0).max(10).default(0),
  amenities: Joi.array().items(Joi.string()).default([]),
  description: Joi.string().max(2000).allow(null, ""),
  status: Joi.string()
    .valid("available", "reserved", "sold", "maintenance")
    .default("available"),
  finishing: Joi.string()
    .valid("finished", "semi-finished", "unfinished", "core-shell", "")
    .allow(null, ""),
  reservation_fee: Joi.number().min(0).default(5000),
  down_payment_percentage: Joi.number().min(0).max(100).default(5),
  installment_months: Joi.number().min(1).max(120).default(48),
});

export const updateUnitSchema = Joi.object({
  unit_number: Joi.string(),
  property_type: Joi.string().valid(
    "Apartment",
    "Duplex",
    "Penthouse",
    "Studio",
    "Villa",
    "Townhouse",
    "Twin House",
    "Chalet",
  ),
  bedrooms: Joi.number().min(0).max(20),
  bathrooms: Joi.number().min(1).max(20),
  area_sqm: Joi.number().min(10).max(10000),
  price: Joi.number().min(0),
  floor: Joi.number().min(-5).max(100).allow(null),
  view_type: Joi.string()
    .valid("street", "garden", "park", "pool", "sea", "city", "")
    .allow(null, ""),
  has_garden: Joi.boolean(),
  garden_area: Joi.number().min(0).allow(null),
  balconies: Joi.number().min(0).max(10),
  amenities: Joi.array().items(Joi.string()),
  description: Joi.string().max(2000).allow(null, ""),
  status: Joi.string().valid("available", "reserved", "sold", "maintenance"),
  finishing: Joi.string()
    .valid("finished", "semi-finished", "unfinished", "core-shell", "")
    .allow(null, ""),
  reservation_fee: Joi.number().min(0),
  down_payment_percentage: Joi.number().min(0).max(100),
  installment_months: Joi.number().min(1).max(120),
}).min(1);

// ============= RESERVATION SCHEMAS =============

export const createReservationSchema = Joi.object({
  unit: Joi.string().required().messages({
    "any.required": "Unit ID is required",
  }),
  notes: Joi.string().max(500).allow(null, ""),
});

// ============= PAYMENT SCHEMAS =============

export const createPaymentSchema = Joi.object({
  reservation: Joi.string().required(),
  amount: Joi.number().min(1).required().messages({
    "number.min": "Payment amount must be greater than 0",
    "any.required": "Payment amount is required",
  }),
  payment_method: Joi.string()
    .valid("credit_card", "fawry", "vodafone_cash", "bank_transfer")
    .required(),
  notes: Joi.string().max(500).allow(null, ""),
});

// ============= WAITLIST SCHEMAS =============

export const joinWaitlistSchema = Joi.object({
  unit: Joi.string().required().messages({
    "any.required": "Unit ID is required",
  }),
  notification_preferences: Joi.object({
    sms: Joi.boolean().default(true),
    email: Joi.boolean().default(true),
    whatsapp: Joi.boolean().default(false),
  }).default({ sms: true, email: true, whatsapp: false }),
});

// ============= PROJECT SCHEMAS =============

export const createProjectSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  description: Joi.string().max(2000).allow(null, ""),
  location: Joi.object({
    address: Joi.string().required(),
    city: Joi.string().required(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90),
      lng: Joi.number().min(-180).max(180),
    }),
  }).required(),
  total_units: Joi.number().min(1),
  amenities: Joi.array().items(Joi.string()).default([]),
  status: Joi.string()
    .valid("planning", "under_construction", "ready", "sold_out")
    .default("under_construction"),
  contact_phone: Joi.string().default("19844"),
});

// ============= BLOCK SCHEMAS =============

export const createBlockSchema = Joi.object({
  name: Joi.string().min(1).max(50).required(),
  project: Joi.string().required(),
  total_floors: Joi.number().min(1).max(100),
  units_per_floor: Joi.number().min(1).max(50),
  description: Joi.string().max(500).allow(null, ""),
});
