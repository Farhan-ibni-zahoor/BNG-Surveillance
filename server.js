// ================================================================
// BNG SURVEILLANCE - BACKEND SERVER (COMPLETE REWRITE)
// With WhatsApp Integration & Enhanced Features
// ================================================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
const nodemailer = require('nodemailer');

// ================================================================
// APP INITIALIZATION
// ================================================================
const app = express();
const PORT = process.env.PORT || 5000;

// ================================================================
// CLOUDINARY CONFIGURATION
// ================================================================
cloudinary.config({ 
    cloud_name: process.env.CLOUD_NAME, 
    api_key: process.env.CLOUD_API_KEY, 
    api_secret: process.env.CLOUD_API_SECRET 
});

// ================================================================
// RAZORPAY CONFIGURATION
// ================================================================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ================================================================
// EMAIL CONFIGURATION
// ================================================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ================================================================
// MIDDLEWARE
// ================================================================

// Request Logger with emojis
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const emoji = req.method === 'GET' ? '📥' : req.method === 'POST' ? '📤' : req.method === 'PUT' ? '✏️' : req.method === 'DELETE' ? '🗑️' : '📋';
    console.log(`${emoji} [${timestamp}] ${req.method} ${req.path}`);
    next();
});

// CORS
app.use(cors());

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// ================================================================
// UTILITIES
// ================================================================

// Email Sender with enhanced HTML templates
const sendEmail = async (to, subject, text, htmlContent = null) => {
    try {
        const mailOptions = {
            from: `BNG Surveillance <${process.env.EMAIL_USER}>`,
            to: to,
            subject: subject,
            text: text,
        };

        if (htmlContent) {
            mailOptions.html = htmlContent;
        }

        await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent successfully to: ${to}`);
        return true;
    } catch (error) {
        console.error(`❌ Email sending failed for ${to}:`, error.message);
        return false;
    }
};

// Validation
const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validatePhone = (phone) => /^[0-9]{10}$/.test(phone.replace(/\D/g, ''));

// ================================================================
// DATABASE CONNECTION
// ================================================================
const connectDB = async (retries = 5) => {
    const DB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bng-surveillance';
    
    for (let i = 0; i < retries; i++) {
        try {
            await mongoose.connect(DB_URI);
            console.log("✅ MongoDB Connected Successfully");
            return;
        } catch (err) {
            console.error(`❌ MongoDB Connection Attempt ${i + 1}/${retries} Failed:`, err.message);
            if (i === retries - 1) {
                console.error("❌ All database connection attempts failed. Exiting...");
                process.exit(1);
            }
            console.log(`⏳ Retrying in 5 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
};

connectDB();

// ================================================================
// DATABASE MODELS
// ================================================================

// User Model
const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: false },
    isVerified: { type: Boolean, default: false },
    otp: String,
    otpExpiry: Date,
    role: { type: String, default: 'customer' },
    createdAt: { type: Date, default: Date.now },
    lastLogin: Date
});

// Product Model
const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    image: { type: String, required: true },
    desc: { type: String, required: true },
    reviews: [{ 
        user: String, 
        comment: String, 
        date: { type: Date, default: Date.now } 
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Enhanced Order Model with Location
const OrderSchema = new mongoose.Schema({
    razorpay_order_id: { type: String, required: true },
    razorpay_payment_id: String,
    payment_status: { type: String, default: 'Pending' },
    customer: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    pincode: { type: String, required: true },
    location: {
        latitude: Number,
        longitude: Number
    },
    items: { type: Array, required: true },
    total: { type: Number, required: true },
    status: { type: String, default: 'Processing' },
    date: { type: Date, default: Date.now },
    deliveredAt: Date,
    cancelledAt: Date,
    refundProcessed: { type: Boolean, default: false }
});

// Request Model with Location
const RequestSchema = new mongoose.Schema({
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    location: {
        latitude: Number,
        longitude: Number
    },
    status: { type: String, default: 'Open' },
    date: { type: Date, default: Date.now },
    resolvedAt: Date
});

const User = mongoose.model('User', UserSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);
const Request = mongoose.model('Request', RequestSchema);

// ================================================================
// FILE UPLOAD SETUP
// ================================================================
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const mimetype = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
        return cb(null, true);
    }
    cb(new Error('Only image files (JPEG, PNG, WebP) are allowed!'));
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// ================================================================
// EMAIL TEMPLATES (Enhanced HTML)
// ================================================================

const getOTPEmailHTML = (otp, name) => `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Arial', sans-serif; background: #f8fafc; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background: white; border: 2px solid #0ea5e9; border-radius: 20px; padding: 40px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 28px; font-weight: 800; color: #0ea5e9; letter-spacing: 2px; }
        .otp-box { background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); border: 3px solid #0ea5e9; border-radius: 15px; padding: 30px; text-align: center; margin: 30px 0; }
        .otp-code { font-size: 48px; font-weight: 900; color: #0ea5e9; letter-spacing: 10px; text-shadow: 2px 2px 4px rgba(0,0,0,0.1); }
        .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🛡️ BNG SURVEILLANCE</div>
            <p style="color: #64748b; margin-top: 10px;">Premium CCTV Solutions</p>
        </div>
        
        <h2 style="color: #0ea5e9; text-align: center;">EMAIL VERIFICATION</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>Welcome to BNG Surveillance! Your One-Time Password (OTP) for account verification is:</p>
        
        <div class="otp-box">
            <div class="otp-code">${otp}</div>
            <p style="color: #64748b; margin-top: 15px; font-size: 14px;">⏱️ Valid for 10 minutes</p>
        </div>
        
        <p style="color: #64748b; font-size: 14px; margin-top: 20px;">
            If you didn't request this code, please ignore this email or contact our support team.
        </p>
        
        <div class="footer">
            <p>© 2024 BNG Surveillance Systems. All Rights Reserved.</p>
            <p>📧 This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
`;

const getOrderConfirmationHTML = (orderDetails) => {
    const itemsList = orderDetails.items.map(item => 
        `<tr>
            <td style="padding: 15px; border-bottom: 1px solid #e2e8f0;">${item.name}</td>
            <td style="padding: 15px; border-bottom: 1px solid #e2e8f0; text-align: center;">${item.qty}</td>
            <td style="padding: 15px; border-bottom: 1px solid #e2e8f0; text-align: center;">₹${item.price.toLocaleString()}</td>
            <td style="padding: 15px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700; color: #0ea5e9;">₹${(item.price * item.qty).toLocaleString()}</td>
        </tr>`
    ).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Arial', sans-serif; background: #f8fafc; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background: white; border: 2px solid #10b981; border-radius: 20px; padding: 40px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 28px; font-weight: 800; color: #0ea5e9; letter-spacing: 2px; }
        .success-icon { font-size: 64px; text-align: center; margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .total-row { background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); font-weight: 800; font-size: 18px; }
        .info-box { background: #f1f5f9; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #0ea5e9; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🛡️ BNG SURVEILLANCE</div>
        </div>
        
        <div class="success-icon">✅</div>
        <h2 style="color: #10b981; text-align: center; margin-bottom: 10px;">ORDER CONFIRMED!</h2>
        <p style="text-align: center; color: #64748b; margin-bottom: 30px;">Thank you for choosing BNG Surveillance</p>
        
        <div class="info-box">
            <h3 style="color: #0ea5e9; margin-top: 0;">📋 Order Details</h3>
            <p style="margin: 5px 0;"><strong>Order ID:</strong> #${orderDetails.razorpay_order_id.substr(-8)}</p>
            <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date(orderDetails.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <p style="margin: 5px 0;"><strong>Status:</strong> <span style="color: #f59e0b; font-weight: 700;">Processing</span></p>
        </div>
        
        <h3 style="color: #0ea5e9; margin-top: 30px;">🛒 Items Ordered:</h3>
        <table>
            <thead>
                <tr style="background: #f1f5f9;">
                    <th style="padding: 15px; text-align: left; color: #1e293b; font-weight: 700;">Product</th>
                    <th style="padding: 15px; text-align: center; color: #1e293b; font-weight: 700;">Qty</th>
                    <th style="padding: 15px; text-align: center; color: #1e293b; font-weight: 700;">Price</th>
                    <th style="padding: 15px; text-align: right; color: #1e293b; font-weight: 700;">Total</th>
                </tr>
            </thead>
            <tbody>
                ${itemsList}
                <tr class="total-row">
                    <td colspan="3" style="padding: 20px; font-weight: 800;">GRAND TOTAL</td>
                    <td style="padding: 20px; text-align: right; color: #0ea5e9; font-size: 24px; font-weight: 900;">₹${orderDetails.total.toLocaleString()}</td>
                </tr>
            </tbody>
        </table>
        
        <div class="info-box">
            <h3 style="color: #0ea5e9; margin-top: 0;">📍 Delivery Address</h3>
            <p style="margin: 5px 0; line-height: 1.6;">${orderDetails.address}</p>
            <p style="margin: 5px 0;"><strong>Pincode:</strong> ${orderDetails.pincode}</p>
            <p style="margin: 5px 0;"><strong>Phone:</strong> ${orderDetails.phone}</p>
        </div>
        
        <div style="background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); padding: 20px; border-radius: 10px; margin: 30px 0; text-align: center;">
            <p style="margin: 0; color: #1e293b; font-size: 16px;">
                🎉 <strong>Our team will contact you within 24 hours to schedule the professional installation.</strong>
            </p>
        </div>
        
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 14px; margin: 5px 0;">Need help? Contact us:</p>
            <p style="color: #0ea5e9; font-weight: 700; font-size: 16px; margin: 5px 0;">📞 +91 600 675 0581</p>
            <p style="color: #0ea5e9; font-weight: 700; font-size: 16px; margin: 5px 0;">📧 bngsurveillance@gmail.com</p>
        </div>
        
        <div style="text-align: center; margin-top: 30px; color: #94a3b8; font-size: 12px;">
            <p>© 2024 BNG Surveillance Systems. All Rights Reserved.</p>
            <p>Professional Installation • 24/7 Support • Premium Quality</p>
        </div>
    </div>
</body>
</html>
`;
};

// ================================================================
// WHATSAPP INTEGRATION
// ================================================================

const sendWhatsAppNotification = (orderDetails) => {
    try {
        const ADMIN_WHATSAPP = '916006750581'; // Admin WhatsApp number
        
        // Build message
        let message = `🛍️ *NEW ORDER RECEIVED*\n\n`;
        message += `📋 *Order ID:* ${orderDetails.razorpay_order_id.substr(-8)}\n`;
        message += `👤 *Customer:* ${orderDetails.customer}\n`;
        message += `📞 *Phone:* ${orderDetails.phone}\n`;
        message += `📧 *Email:* ${orderDetails.email}\n`;
        message += `📍 *Address:* ${orderDetails.address}, ${orderDetails.pincode}\n\n`;
        
        message += `🛒 *Products:*\n`;
        orderDetails.items.forEach(item => {
            message += `• ${item.qty}× ${item.name} @ ₹${item.price.toLocaleString()}\n`;
        });
        
        message += `\n💰 *Total Amount:* ₹${orderDetails.total.toLocaleString()}\n`;
        message += `💳 *Payment:* Paid via Razorpay\n`;
        message += `📅 *Date:* ${new Date(orderDetails.date).toLocaleDateString('en-IN')}\n`;
        
        if (orderDetails.location && orderDetails.location.latitude && orderDetails.location.longitude) {
            const gmapsLink = `https://www.google.com/maps?q=${orderDetails.location.latitude},${orderDetails.location.longitude}`;
            message += `\n📍 *Customer Location:*\n${gmapsLink}\n`;
        }
        
        message += `\n✅ *Action Required:* Contact customer for installation scheduling`;
        
        const whatsappUrl = `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(message)}`;
        
        console.log('📱 WhatsApp notification prepared for admin');
        console.log(`🔗 WhatsApp URL: ${whatsappUrl}`);
        
        return whatsappUrl;
        
    } catch (error) {
        console.error('❌ WhatsApp notification error:', error.message);
        return null;
    }
};

// ================================================================
// API ROUTES
// ================================================================

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'Connected ✅' : 'Disconnected ❌',
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// --- AUTHENTICATION ROUTES ---

// Register
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ error: "All fields are required" });
    }
    
    if (!validateEmail(email)) {
        return res.status(400).json({ error: "Invalid email format" });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    try {
        let user = await User.findOne({ email });
        
        if (user && user.isVerified) {
            return res.status(400).json({ error: "Email already registered" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

        if (user && !user.isVerified) {
            user.name = name;
            user.password = password;
            user.otp = otp;
            user.otpExpiry = otpExpiry;
            await user.save();
            console.log(`🔄 Updated unverified user: ${email}`);
        } else {
            user = new User({ 
                name, 
                email, 
                password, 
                otp, 
                otpExpiry,
                isVerified: false 
            });
            await user.save();
            console.log(`✅ New user created: ${email}`);
        }

        const htmlContent = getOTPEmailHTML(otp, name);
        await sendEmail(
            email, 
            '🔐 Verify Your Account - BNG Surveillance', 
            `Your Verification OTP is: ${otp}\n\nThis code will expire in 10 minutes.`,
            htmlContent
        );
        
        res.json({ message: "Verification code sent to email." });

    } catch (err) {
        console.error('❌ Registration Error:', err);
        res.status(500).json({ error: "Registration Failed" });
    }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ error: "Email and OTP are required" });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(400).json({ error: "User not found" });
        }

        if (user.otpExpiry && new Date() > user.otpExpiry) {
            return res.status(400).json({ error: "OTP has expired. Please request a new one." });
        }

        if (user.otp === otp) {
            user.isVerified = true;
            user.otp = null;
            user.otpExpiry = null;
            await user.save();
            
            console.log(`✅ User verified successfully: ${email}`);
            res.json({ message: "Email verified successfully." });
        } else {
            res.status(400).json({ error: "Invalid OTP" });
        }
    } catch (e) { 
        console.error('❌ OTP Verification Error:', e);
        res.status(500).json({ error: "Verification failed" }); 
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }
    
    // Admin login
    if (email === "bngsurveillance@gmail.com" && password === "Surveillance@0627") {
        console.log(`✅ Admin login successful: ${email}`);
        return res.json({ 
            name: "Admin", 
            email, 
            role: "author", 
            phone: "916006750581" 
        }); 
    }
    
    try {
        const user = await User.findOne({ email, password });
        
        if (!user) {
            return res.status(401).json({ error: "Invalid Credentials" });
        }
        
        if (!user.isVerified) {
            return res.status(403).json({ error: "Account not verified. Please verify your email first." });
        }

        user.lastLogin = new Date();
        await user.save();

        console.log(`✅ User login successful: ${email}`);
        res.json({
            name: user.name,
            email: user.email,
            role: user.role
        });

    } catch (e) { 
        console.error('❌ Login Error:', e);
        res.status(500).json({ error: "Server Error" }); 
    }
});

// --- PRODUCT ROUTES ---

// Get All Products
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        console.log(`📦 Fetched ${products.length} products`);
        res.json(products);
    } catch (e) { 
        console.error('❌ Fetch Products Error:', e);
        res.status(500).json({ error: e.message }); 
    }
});

// Add Product
app.post('/api/products', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image file uploaded" });
        }

        const { name, category, price, desc, stock } = req.body;

        if (!name || !category || !price || !desc) {
            return res.status(400).json({ error: "All fields are required" });
        }

        const uploadStream = cloudinary.uploader.upload_stream(
            { 
                folder: 'bng_surveillance', 
                resource_type: 'image',
                transformation: [
                    { width: 800, height: 800, crop: 'limit' },
                    { quality: 'auto:good' }
                ]
            },
            async (error, result) => {
                if (error) {
                    console.error('❌ Cloudinary Upload Error:', error);
                    return res.status(500).json({ error: "Image upload failed" });
                }

                const newProduct = new Product({ 
                    name, 
                    category, 
                    price: Number(price), 
                    stock: Number(stock) || 0,
                    image: result.secure_url, 
                    desc, 
                    reviews: [] 
                });
                
                await newProduct.save();
                console.log(`✅ Product added successfully: ${name}`);
                res.json(newProduct);
            }
        );
        
        streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
        
    } catch (err) { 
        console.error('❌ Add Product Error:', err);
        res.status(500).json({ error: "Server Error" }); 
    }
});

// Edit Product
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
    try {
        const { name, category, price, desc, stock } = req.body;
        
        const updateData = {
            name,
            category,
            price: Number(price),
            stock: Number(stock),
            desc,
            updatedAt: new Date()
        };

        if (req.file) {
            const uploadStream = cloudinary.uploader.upload_stream(
                { 
                    folder: 'bng_surveillance', 
                    resource_type: 'image',
                    transformation: [
                        { width: 800, height: 800, crop: 'limit' },
                        { quality: 'auto:good' }
                    ]
                },
                async (error, result) => {
                    if (error) {
                        console.error('❌ Cloudinary Upload Error:', error);
                        return res.status(500).json({ error: "Image upload failed" });
                    }
                    
                    updateData.image = result.secure_url;
                    const updatedProduct = await Product.findByIdAndUpdate(
                        req.params.id, 
                        updateData, 
                        { new: true }
                    );
                    
                    console.log(`✅ Product updated successfully: ${updatedProduct.name}`);
                    res.json(updatedProduct);
                }
            );
            streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
        } else {
            const updatedProduct = await Product.findByIdAndUpdate(
                req.params.id, 
                updateData, 
                { new: true }
            );
            
            console.log(`✅ Product updated successfully: ${updatedProduct.name}`);
            res.json(updatedProduct);
        }
    } catch (e) {
        console.error('❌ Update Product Error:', e);
        res.status(500).json({ error: "Update failed" });
    }
});

// Delete Product
app.delete('/api/products/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        
        if (!product) {
            return res.status(404).json({ error: "Product not found" });
        }

        // Delete image from Cloudinary
        if (product.image) {
            try {
                const urlParts = product.image.split('/');
                const publicIdWithExt = urlParts[urlParts.length - 1];
                const publicId = `bng_surveillance/${publicIdWithExt.split('.')[0]}`;
                await cloudinary.uploader.destroy(publicId);
                console.log(`🗑️ Cloudinary image deleted: ${publicId}`);
            } catch (cloudinaryError) {
                console.error('⚠️ Cloudinary deletion warning:', cloudinaryError.message);
            }
        }

        await Product.findByIdAndDelete(req.params.id);
        
        console.log(`✅ Product deleted successfully: ${product.name}`);
        res.json({ message: "Product deleted successfully" });
        
    } catch (e) {
        console.error('❌ Delete Product Error:', e);
        res.status(500).json({ error: "Delete failed" });
    }
});

// Add Review
app.post('/api/review/:id', async (req, res) => {
    try {
        const { user, comment } = req.body;
        
        if (!user || !comment) {
            return res.status(400).json({ error: "User and comment are required" });
        }

        const product = await Product.findById(req.params.id);
        
        if (!product) {
            return res.status(404).json({ error: "Product not found" });
        }
        
        product.reviews.push({ user, comment, date: new Date() });
        await product.save();
        
        console.log(`✅ Review added to product: ${product.name}`);
        res.json({ message: "Review Added Successfully" });
        
    } catch (err) { 
        console.error('❌ Add Review Error:', err);
        res.status(500).json({ error: err.message }); 
    }
});

// --- PAYMENT ROUTES ---

// Create Razorpay Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: "Invalid amount" });
        }

        const options = { 
            amount: amount * 100, // Convert to paise
            currency: "INR", 
            receipt: "receipt_" + Date.now(),
            notes: {
                created_at: new Date().toISOString(),
                purpose: 'BNG Surveillance Product Purchase'
            }
        };
        
        const order = await razorpay.orders.create(options);
        console.log(`✅ Razorpay order created: ${order.id} | Amount: ₹${amount}`);
        res.json(order);
        
    } catch (error) { 
        console.error('❌ Razorpay Order Creation Error:', error);
        res.status(500).json({ error: "Payment gateway error" }); 
    }
});

// Verify Payment & Create Order
app.post('/api/verify-payment', async (req, res) => {
    const { orderCreationId, razorpayPaymentId, razorpaySignature, customerDetails } = req.body;
    
    try {
        // Validate signature
        const shasum = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
        shasum.update(`${orderCreationId}|${razorpayPaymentId}`);
        const digest = shasum.digest("hex");
        
        if (digest !== razorpaySignature) {
            console.error('❌ Invalid payment signature');
            return res.status(400).json({ message: "Invalid Transaction Signature" });
        }

        // Validate customer details
        if (!customerDetails.phone || !validatePhone(customerDetails.phone)) {
            return res.status(400).json({ error: "Invalid phone number" });
        }

        // Deduct stock for each product
        if (customerDetails.items && customerDetails.items.length > 0) {
            for (const item of customerDetails.items) {
                if (item._id && item.qty) {
                    const product = await Product.findById(item._id);
                    
                    if (!product) {
                        console.error(`❌ Product not found: ${item._id}`);
                        continue;
                    }
                    
                    if (product.stock < item.qty) {
                        return res.status(400).json({ 
                            error: `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.qty}` 
                        });
                    }
                    
                    await Product.findByIdAndUpdate(item._id, { 
                        $inc: { stock: -item.qty } 
                    });
                    
                    console.log(`✅ Stock deducted: ${product.name} (-${item.qty} units)`);
                }
            }
        }

        // Create order in database
        const newOrder = new Order({
            razorpay_order_id: orderCreationId,
            razorpay_payment_id: razorpayPaymentId,
            payment_status: "Paid",
            customer: customerDetails.name,
            email: customerDetails.email,
            phone: customerDetails.phone,
            address: customerDetails.address,
            pincode: customerDetails.pincode,
            location: customerDetails.location || null,
            items: customerDetails.items,
            total: customerDetails.total,
            status: "Processing",
            date: new Date()
        });
        
        await newOrder.save();
        console.log(`✅ Order saved to database: ${newOrder._id}`);

        // Send WhatsApp notification to admin
        const whatsappUrl = sendWhatsAppNotification(newOrder);
        
        // Send confirmation email to customer
        const customerHtmlEmail = getOrderConfirmationHTML(newOrder);
        await sendEmail(
            customerDetails.email,
            '✅ Order Confirmed - BNG Surveillance',
            `Thank you for your order! Order ID: #${orderCreationId.substr(-8)}`,
            customerHtmlEmail
        );

        // Send notification email to admin
        const itemList = customerDetails.items.map(i => 
            `${i.qty}x ${i.name} @ ₹${i.price.toLocaleString()}`
        ).join('\n');
        
        let locationInfo = '';
        if (customerDetails.location && customerDetails.location.latitude && customerDetails.location.longitude) {
            const gmapsLink = `https://www.google.com/maps?q=${customerDetails.location.latitude},${customerDetails.location.longitude}`;
            locationInfo = `\n\n📍 Customer Location:\n${gmapsLink}`;
        }
        
        await sendEmail(
            process.env.EMAIL_USER, 
            `💰 NEW ORDER: ₹${customerDetails.total.toLocaleString()} - ${customerDetails.name}`, 
            `NEW ORDER RECEIVED!\n\n` +
            `Order ID: ${orderCreationId}\n` +
            `Date: ${new Date().toLocaleString('en-IN')}\n\n` +
            `CUSTOMER DETAILS:\n` +
            `Name: ${customerDetails.name}\n` +
            `Email: ${customerDetails.email}\n` +
            `Phone: ${customerDetails.phone}\n` +
            `Address: ${customerDetails.address}, ${customerDetails.pincode}${locationInfo}\n\n` +
            `ITEMS ORDERED:\n${itemList}\n\n` +
            `TOTAL AMOUNT: ₹${customerDetails.total.toLocaleString()}\n` +
            `Payment ID: ${razorpayPaymentId}\n\n` +
            `ACTION: Contact customer for installation scheduling\n` +
            (whatsappUrl ? `\n📱 WhatsApp Link: ${whatsappUrl}` : '')
        );

        console.log(`✅ All notifications sent successfully`);

        res.json({ 
            message: "Payment Successful", 
            orderId: newOrder._id,
            whatsappUrl: whatsappUrl
        });

    } catch (error) { 
        console.error('❌ Payment Verification Error:', error);
        res.status(500).json({ error: "Payment verification failed" }); 
    }
});

// --- ORDER ROUTES ---

// Get All Orders (Admin)
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ date: -1 });
        console.log(`📋 Fetched ${orders.length} orders`);
        res.json(orders);
    } catch (e) {
        console.error('❌ Fetch Orders Error:', e);
        res.status(500).json({ error: "Failed to fetch orders" });
    }
});

// Get User Orders
app.get('/api/my-orders', async (req, res) => {
    try {
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({ error: "Email parameter is required" });
        }

        const orders = await Order.find({ email }).sort({ date: -1 });
        console.log(`📋 Fetched ${orders.length} orders for ${email}`);
        res.json(orders);
        
    } catch (e) {
        console.error('❌ Fetch User Orders Error:', e);
        res.status(500).json({ error: "Failed to fetch orders" });
    }
});

// Mark Order as Delivered
app.patch('/api/orders/:id/deliver', async (req, res) => {
    try {
        const updated = await Order.findByIdAndUpdate(
            req.params.id, 
            { 
                status: 'Delivered',
                deliveredAt: new Date()
            },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ error: "Order not found" });
        }

        console.log(`✅ Order marked as delivered: ${req.params.id}`);
        res.json({ message: "Order marked as delivered", order: updated });
        
    } catch (e) {
        console.error('❌ Deliver Order Error:', e);
        res.status(500).json({ error: "Update failed" });
    }
});

// Cancel Order & Process Refund
app.patch('/api/orders/:id/cancel', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        if (order.status !== 'Processing') {
            return res.status(400).json({ 
                error: "Only processing orders can be cancelled" 
            });
        }

        // Restore stock for cancelled items
        if (order.items && order.items.length > 0) {
            for (const item of order.items) {
                if (item._id && item.qty) {
                    await Product.findByIdAndUpdate(item._id, { 
                        $inc: { stock: item.qty } 
                    });
                    console.log(`✅ Stock restored: ${item.name} (+${item.qty} units)`);
                }
            }
        }

        // Update order status
        const updated = await Order.findByIdAndUpdate(
            req.params.id,
            {
                status: 'Refund Processing',
                cancelledAt: new Date(),
                refundProcessed: false
            },
            { new: true }
        );

        // Email customer about cancellation
        await sendEmail(
            order.email,
            '🔄 Order Cancelled - Refund Processing - BNG Surveillance',
            `Dear ${order.customer},\n\n` +
            `Your order #${order.razorpay_order_id.substr(-8)} has been successfully cancelled.\n\n` +
            `Refund Amount: ₹${order.total.toLocaleString()}\n` +
            `Refund will be processed to your original payment method within 7 business days.\n\n` +
            `If you have any questions, please contact our support team.\n\n` +
            `Thank you,\nBNG Surveillance Team`
        );

        // Notify admin about cancellation
        await sendEmail(
            process.env.EMAIL_USER,
            `❌ Order Cancelled - Refund Required - Order #${order.razorpay_order_id.substr(-8)}`,
            `ORDER CANCELLATION NOTICE\n\n` +
            `Order ID: ${order.razorpay_order_id}\n` +
            `Customer: ${order.customer}\n` +
            `Email: ${order.email}\n` +
            `Phone: ${order.phone}\n` +
            `Refund Amount: ₹${order.total.toLocaleString()}\n` +
            `Payment ID: ${order.razorpay_payment_id}\n\n` +
            `ACTION REQUIRED: Process refund within 7 business days`
        );

        console.log(`✅ Order cancelled successfully: ${req.params.id}`);
        res.json({ 
            message: "Order cancelled. Refund will be processed within 7 days.",
            order: updated
        });
        
    } catch (e) {
        console.error('❌ Cancel Order Error:', e);
        res.status(500).json({ error: "Cancellation failed" });
    }
});

// --- SUPPORT REQUEST ROUTES ---

// Submit Support Request
app.post('/api/requests', async (req, res) => {
    try {
        const { customerName, email, type, message, location } = req.body;

        if (!customerName || !email || !type || !message) {
            return res.status(400).json({ error: "All fields are required" });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ error: "Invalid email format" });
        }

        const newRequest = new Request({
            customerName,
            email,
            type,
            message,
            location: location || null,
            status: 'Open',
            date: new Date()
        });
        await newRequest.save();

        // Build location info for email
        let locationInfo = '';
        if (location && location.latitude && location.longitude) {
            const gmapsLink = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
            locationInfo = `\n\n📍 Customer Location:\n${gmapsLink}`;
        }

        // Send notification to admin
        await sendEmail(
            process.env.EMAIL_USER, 
            `🔔 NEW ${type.toUpperCase()} REQUEST - ${customerName}`, 
            `NEW SERVICE REQUEST RECEIVED\n\n` +
            `Type: ${type}\n` +
            `From: ${customerName}\n` +
            `Email: ${email}\n` +
            `Date: ${new Date().toLocaleString('en-IN')}\n\n` +
            `MESSAGE:\n${message}${locationInfo}\n\n` +
            `Please contact the customer within 24 hours.`
        );

        console.log(`✅ Support request created: ${newRequest._id} | Type: ${type}`);
        res.json(newRequest);
        
    } catch (e) { 
        console.error('❌ Create Request Error:', e);
        res.status(500).json({ error: "Failed to save request" }); 
    }
});

// Get All Support Requests (Admin)
app.get('/api/admin/requests', async (req, res) => {
    try {
        const requests = await Request.find().sort({ date: -1 });
        console.log(`📋 Fetched ${requests.length} support requests`);
        res.json(requests);
    } catch (e) { 
        console.error('❌ Fetch Requests Error:', e);
        res.status(500).json({ error: "Failed to fetch requests" }); 
    }
});

// Delete Support Request
app.delete('/api/requests/:id', async (req, res) => {
    try {
        const deleted = await Request.findByIdAndDelete(req.params.id);
        
        if (!deleted) {
            return res.status(404).json({ error: "Request not found" });
        }

        console.log(`✅ Support request deleted: ${req.params.id}`);
        res.json({ message: "Request deleted successfully" });
        
    } catch (e) { 
        console.error('❌ Delete Request Error:', e);
        res.status(500).json({ error: "Delete operation failed" }); 
    }
});

// Mark Support Request as Solved
app.patch('/api/requests/:id/solve', async (req, res) => {
    try {
        const updated = await Request.findByIdAndUpdate(
            req.params.id, 
            { 
                status: 'Solved',
                resolvedAt: new Date()
            },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ error: "Request not found" });
        }

        console.log(`✅ Support request marked as solved: ${req.params.id}`);
        res.json({ message: "Request marked as solved", request: updated });
        
    } catch (e) { 
        console.error('❌ Solve Request Error:', e);
        res.status(500).json({ error: "Update failed" }); 
    }
});

// ================================================================
// ERROR HANDLING
// ================================================================

// 404 Handler
app.use((req, res) => {
    console.log(`⚠️ 404 - Route not found: ${req.method} ${req.path}`);
    res.status(404).json({ 
        error: "Route not found",
        path: req.path,
        method: req.method
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled Server Error:', err);
    
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `File upload error: ${err.message}` });
    }
    
    res.status(500).json({ 
        error: "Internal Server Error",
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// ================================================================
// GRACEFUL SHUTDOWN HANDLERS
// ================================================================

const gracefulShutdown = async (signal) => {
    console.log(`\n⚠️ ${signal} signal received. Starting graceful shutdown...`);
    
    try {
        await mongoose.connection.close();
        console.log('✅ Database connection closed');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// ================================================================
// START SERVER
// ================================================================
module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║         🛡️  BNG SURVEILLANCE - SERVER ACTIVE  🛡️              ║
║                                                              ║
║  🚀 Server Running on Port: ${PORT.toString().padEnd(33)}║
║  📊 Environment: ${(process.env.NODE_ENV || 'development').padEnd(44)}║
║  🔐 MongoDB: ${(mongoose.connection.readyState === 1 ? 'Connected ✅' : 'Connecting ⏳').padEnd(49)}║
║  💳 Razorpay: Configured ✅                                  ║
║  ☁️  Cloudinary: Configured ✅                                ║
║  📧 Email Service: Configured ✅                             ║
║  📱 WhatsApp: Enabled ✅                                     ║
║                                                              ║
║  🌐 API Documentation: /api/health                          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
        `);
        
        console.log('📋 Available API Endpoints:');
        console.log('   AUTH: /api/register, /api/verify-otp, /api/login');
        console.log('   PRODUCTS: /api/products');
        console.log('   PAYMENTS: /api/create-order, /api/verify-payment');
        console.log('   ORDERS: /api/orders, /api/my-orders');
        console.log('   REQUESTS: /api/requests, /api/admin/requests');
        console.log('\n✅ Server is ready to accept connections!\n');
    });
}