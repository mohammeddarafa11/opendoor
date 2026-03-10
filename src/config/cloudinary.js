import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    let folderName = "K-Developments/Others";
    if (req.originalUrl.includes("units")) folderName = "K-Developments/Units";
    if (req.originalUrl.includes("projects"))
      folderName = "K-Developments/Projects";

    return {
      folder: folderName,
      allowed_formats: ["jpg", "png", "jpeg", "webp"],
      transformation: [{ width: 1200, height: 800, crop: "limit" }],
    };
  },
});

const upload = multer({ storage: storage });
export default upload;
