// ================================================================
// 1. IMPORTS & SETUP
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

// Initialize App
const app = express();
const PORT = process.env.PORT || 5000;

// ================================================================
// 2. CONFIGURATIONS
// ================================================================

// Cloudinary (Image Hosting)
cloudinary.config({ 
    cloud_name: process.env.CLOUD_NAME, 
    api_key: process.env.CLOUD_API_KEY, 
    api_secret: process.env.CLOUD_API_SECRET 
});

// Razorpay (Payments)
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Email System (Nodemailer)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ================================================================
// 3. MIDDLEWARE & UTILITIES
// ================================================================

// Request Logger Middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// Enhanced Email Sender with HTML Templates
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
        console.error(`❌ FAILED to send email to ${to}:`, error.message);
        return false;
    }
};

// Validation Helper
const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const validatePhone = (phone) => {
    const re = /^[0-9]{10}$/;
    return re.test(phone.replace(/\D/g, ''));
};

// Database Connection with Retry Logic
const connectDB = async (retries = 5) => {
    const DB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bng-surveillance';
    
    for (let i = 0; i < retries; i++) {
        try {
            await mongoose.connect(DB_URI);
            console.log("✅ MongoDB Database Connected Successfully");
            return;
        } catch (err) {
            console.error(`❌ MongoDB Connection Attempt ${i + 1} Failed:`, err.message);
            if (i === retries - 1) {
                console.error("❌ All MongoDB connection attempts failed. Exiting...");
                process.exit(1);
            }
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
        }
    }
};

connectDB();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ================================================================
// 4. DATABASE SCHEMAS (MODELS)
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

// Order Model
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
        longitude: Number,
        accuracy: Number
    },
    items: { type: Array, required: true },
    total: { type: Number, required: true },
    status: { type: String, default: 'Processing' }, // Processing, Delivered, Cancelled, Refund Processing
    date: { type: Date, default: Date.now },
    deliveredAt: Date,
    cancelledAt: Date,
    refundProcessed: { type: Boolean, default: false }
});

// Service Request Model
const RequestSchema = new mongoose.Schema({
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    location: {
        latitude: Number,
        longitude: Number,
        accuracy: Number
    },
    status: { type: String, default: 'Open' },
    date: { type: Date, default: Date.now },
    resolvedAt: Date
});

const User = mongoose.model('User', UserSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);
const Request = mongoose.model('Request', RequestSchema);

// Setup File Upload with File Type Validation
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
// 5. EMAIL TEMPLATES
// ================================================================

const getOTPEmailHTML = (otp, name) => `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Arial', sans-serif; background: #020202; color: #fff; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background: #0a0a0a; border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 20px; padding: 40px; }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 28px; font-weight: 800; color: #f59e0b; letter-spacing: 2px; }
        .otp-box { background: rgba(245, 158, 11, 0.1); border: 2px solid #f59e0b; border-radius: 15px; padding: 30px; text-align: center; margin: 30px 0; }
        .otp-code { font-size: 48px; font-weight: 900; color: #f59e0b; letter-spacing: 10px; }
        .footer { text-align: center; margin-top: 30px; color: #888; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🛡️ BNG SURVEILLANCE</div>
            <p style="color: #888; margin-top: 10px;">Secure Systems Command</p>
        </div>
        
        <h2 style="color: #f59e0b; text-align: center;">AUTHENTICATION REQUIRED</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>Your One-Time Password (OTP) for account verification is:</p>
        
        <div class="otp-box">
            <div class="otp-code">${otp}</div>
            <p style="color: #888; margin-top: 15px;">Valid for 10 minutes</p>
        </div>
        
        <p style="color: #aaa;">If you didn't request this code, please ignore this email.</p>
        
        <div class="footer">
            <p>© 2024 BNG Surveillance Systems. All Rights Reserved.</p>
            <p>This is an automated message. Please do not reply.</p>
        </div>
    </div>
</body>
</html>
`;

const getOrderConfirmationHTML = (orderDetails) => {
    const itemsList = orderDetails.items.map(item => 
        `<tr>
            <td style="padding: 10px; border-bottom: 1px solid #222;">${item.name}</td>
            <td style="padding: 10px; border-bottom: 1px solid #222; text-align: center;">${item.qty}</td>
            <td style="padding: 10px; border-bottom: 1px solid #222; text-align: right;">₹${(item.price * item.qty).toLocaleString()}</td>
        </tr>`
    ).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: 'Arial', sans-serif; background: #020202; color: #fff; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background: #0a0a0a; border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 20px; padding: 40px; }
        .header { text-align: center; margin-bottom: 30px; }
        .logo { font-size: 28px; font-weight: 800; color: #f59e0b; letter-spacing: 2px; }
        .success-icon { font-size: 64px; text-align: center; margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .total-row { background: rgba(245, 158, 11, 0.1); font-weight: 800; font-size: 18px; }
        .info-box { background: rgba(255,255,255,0.03); padding: 20px; border-radius: 10px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🛡️ BNG SURVEILLANCE</div>
        </div>
        
        <div class="success-icon">✅</div>
        <h2 style="color: #10b981; text-align: center;">ORDER CONFIRMED</h2>
        
        <p>Dear <strong>${orderDetails.customer}</strong>,</p>
        <p>Thank you for your order! Your hardware acquisition has been successfully processed.</p>
        
        <div class="info-box">
            <h3 style="color: #f59e0b; margin-top: 0;">Order Details</h3>
            <p><strong>Order ID:</strong> #${orderDetails.razorpay_order_id.substr(-8)}</p>
            <p><strong>Date:</strong> ${new Date(orderDetails.date).toLocaleDateString()}</p>
        </div>
        
        <h3 style="color: #f59e0b;">Items Ordered:</h3>
        <table>
            <thead>
                <tr style="background: #111;">
                    <th style="padding: 10px; text-align: left;">Product</th>
                    <th style="padding: 10px; text-align: center;">Qty</th>
                    <th style="padding: 10px; text-align: right;">Amount</th>
                </tr>
            </thead>
            <tbody>
                ${itemsList}
                <tr class="total-row">
                    <td colspan="2" style="padding: 15px;">TOTAL</td>
                    <td style="padding: 15px; text-align: right; color: #f59e0b;">₹${orderDetails.total.toLocaleString()}</td>
                </tr>
            </tbody>
        </table>
        
        <div class="info-box">
            <h3 style="color: #f59e0b; margin-top: 0;">Delivery Address</h3>
            <p>${orderDetails.address}</p>
            <p>Pincode: ${orderDetails.pincode}</p>
            <p>Phone: ${orderDetails.phone}</p>
        </div>
        
        <p style="color: #aaa; margin-top: 30px;">Our team will contact you shortly to confirm the installation schedule.</p>
        
        <div style="text-align: center; margin-top: 30px; color: #888; font-size: 12px;">
            <p>© 2024 BNG Surveillance Systems. All Rights Reserved.</p>
        </div>
    </div>
</body>
</html>
`;
};

// ================================================================
// 6. API ROUTES
// ================================================================

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
    });
});

// --- AUTHENTICATION ---

// Register User
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    
    // Validation
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
        
        // Prevent re-registering verified users
        if (user && user.isVerified) {
            return res.status(400).json({ error: "Email already registered" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        if (user && !user.isVerified) {
            // Update existing unverified user
            user.name = name;
            user.password = password;
            user.otp = otp;
            user.otpExpiry = otpExpiry;
            await user.save();
        } else {
            // Create new user
            user = new User({ 
                name, 
                email, 
                password, 
                otp, 
                otpExpiry,
                isVerified: false 
            });
            await user.save();
        }

        // Send OTP Email with HTML template
        const htmlContent = getOTPEmailHTML(otp, name);
        await sendEmail(
            email, 
            '🔐 Verify Your Account - BNG Surveillance', 
            `Your Verification OTP is: ${otp}\n\nThis code will expire in 10 minutes.`,
            htmlContent
        );
        
        res.json({ message: "Verification code sent to email." });

    } catch (err) {
        console.error('Registration Error:', err);
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

        // Check if OTP expired
        if (user.otpExpiry && new Date() > user.otpExpiry) {
            return res.status(400).json({ error: "OTP has expired. Please request a new one." });
        }

        if (user.otp === otp) {
            user.isVerified = true;
            user.otp = null;
            user.otpExpiry = null;
            await user.save();
            
            console.log(`✅ User verified: ${email}`);
            res.json({ message: "Email verified successfully." });
        } else {
            res.status(400).json({ error: "Invalid OTP" });
        }
    } catch (e) { 
        console.error('OTP Verification Error:', e);
        res.status(500).json({ error: "Verification failed" }); 
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }
    
    // HARDCODED ADMIN LOGIN (Secure this in production with env variables)
    if (email === "bngsurveillance@gmail.com" && password === "Surveillance@0627") {
        console.log(`✅ Admin login: ${email}`);
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
            return res.status(403).json({ error: "Account not verified. Please verify OTP." });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        console.log(`✅ User login: ${email}`);
        res.json({
            name: user.name,
            email: user.email,
            role: user.role
        });

    } catch (e) { 
        console.error('Login Error:', e);
        res.status(500).json({ error: "Server Error" }); 
    }
});

// --- PRODUCT MANAGEMENT ---

// Get All Products
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        res.json(products);
    } catch (e) { 
        console.error('Fetch Products Error:', e);
        res.status(500).json({ error: e.message }); 
    }
});

// Add New Product (Admin)
app.post('/api/products', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image file uploaded" });
        }

        const { name, category, price, desc, stock } = req.body;

        // Validation
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
                    console.error('Cloudinary Upload Error:', error);
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
                console.log(`✅ Product added: ${name}`);
                res.json(newProduct);
            }
        );
        
        streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
        
    } catch (err) { 
        console.error('Add Product Error:', err);
        res.status(500).json({ error: "Server Error" }); 
    }
});

// Edit Product (Admin)
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

        // If new image is provided, upload it first
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
                        console.error('Cloudinary Upload Error:', error);
                        return res.status(500).json({ error: "Image upload failed" });
                    }
                    
                    updateData.image = result.secure_url;
                    const updatedProduct = await Product.findByIdAndUpdate(
                        req.params.id, 
                        updateData, 
                        { new: true }
                    );
                    
                    console.log(`✅ Product updated: ${updatedProduct.name}`);
                    res.json(updatedProduct);
                }
            );
            streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
        } else {
            // No new image, just update data
            const updatedProduct = await Product.findByIdAndUpdate(
                req.params.id, 
                updateData, 
                { new: true }
            );
            
            console.log(`✅ Product updated: ${updatedProduct.name}`);
            res.json(updatedProduct);
        }
    } catch (e) {
        console.error('Update Product Error:', e);
        res.status(500).json({ error: "Update failed" });
    }
});

// Delete Product (Admin)
app.delete('/api/products/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        
        if (!product) {
            return res.status(404).json({ error: "Product not found" });
        }

        // Optional: Delete image from Cloudinary
        // Extract public_id from image URL and delete
        if (product.image) {
            try {
                const urlParts = product.image.split('/');
                const publicIdWithExt = urlParts[urlParts.length - 1];
                const publicId = `bng_surveillance/${publicIdWithExt.split('.')[0]}`;
                await cloudinary.uploader.destroy(publicId);
                console.log(`✅ Image deleted from Cloudinary: ${publicId}`);
            } catch (cloudinaryError) {
                console.error('Cloudinary deletion error:', cloudinaryError.message);
                // Continue with product deletion even if image deletion fails
            }
        }

        await Product.findByIdAndDelete(req.params.id);
        
        console.log(`✅ Product deleted: ${product.name} (ID: ${req.params.id})`);
        res.json({ message: "Product deleted successfully" });
        
    } catch (e) {
        console.error('Delete Product Error:', e);
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
        
        product.reviews.push({ user, comment });
        await product.save();
        
        console.log(`✅ Review added to ${product.name} by ${user}`);
        res.json({ message: "Review Added" });
        
    } catch (err) { 
        console.error('Add Review Error:', err);
        res.status(500).json({ error: err.message }); 
    }
});

// --- ORDER & PAYMENT PROCESSING ---

// Create Razorpay Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: "Invalid amount" });
        }

        const options = { 
            amount: amount * 100, // Amount in paisa
            currency: "INR", 
            receipt: "receipt_" + Date.now(),
            notes: {
                created_at: new Date().toISOString()
            }
        };
        
        const order = await razorpay.orders.create(options);
        console.log(`✅ Razorpay order created: ${order.id}`);
        res.json(order);
        
    } catch (error) { 
        console.error('Razorpay Order Creation Error:', error);
        res.status(500).json({ error: "Payment gateway error" }); 
    }
});

// Verify Payment & Process Order
app.post('/api/verify-payment', async (req, res) => {
    const { orderCreationId, razorpayPaymentId, razorpaySignature, customerDetails } = req.body;
    
    try {
        // Validate signature
        const shasum = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
        shasum.update(`${orderCreationId}|${razorpayPaymentId}`);
        
        if (shasum.digest("hex") !== razorpaySignature) {
            console.error('❌ Invalid payment signature');
            return res.status(400).json({ message: "Invalid Transaction" });
        }

        // Validate customer details
        if (!customerDetails.phone || !validatePhone(customerDetails.phone)) {
            return res.status(400).json({ error: "Invalid phone number" });
        }

        // 1. DEDUCT STOCK
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
                            error: `Insufficient stock for ${product.name}` 
                        });
                    }
                    
                    await Product.findByIdAndUpdate(item._id, { 
                        $inc: { stock: -item.qty } 
                    });
                    
                    console.log(`✅ Stock deducted: ${product.name} (-${item.qty})`);
                }
            }
        }

        // 2. SAVE ORDER
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
            status: "Processing"
        });
        
        await newOrder.save();
        console.log(`✅ Order saved: ${newOrder._id}`);

        // 3. EMAIL NOTIFICATION TO CUSTOMER
        const customerHtmlEmail = getOrderConfirmationHTML(newOrder);
        await sendEmail(
            customerDetails.email,
            '✅ Order Confirmed - BNG Surveillance',
            `Thank you for your order! Order ID: #${orderCreationId.substr(-8)}`,
            customerHtmlEmail
        );

        // 4. EMAIL NOTIFICATION TO ADMIN
        const itemList = customerDetails.items.map(i => 
            `${i.qty}x ${i.name} @ ₹${i.price}`
        ).join('\n');
        
        let locationInfo = '';
        if (customerDetails.location) {
            const gmapsLink = `https://www.google.com/maps?q=${customerDetails.location.latitude},${customerDetails.location.longitude}`;
            locationInfo = `\n\n📍 Customer Location (Google Maps):\n${gmapsLink}`;
        }
        
        await sendEmail(
            process.env.EMAIL_USER, 
            `💰 NEW ORDER: ₹${customerDetails.total} - ${customerDetails.name}`, 
            `YOU HAVE A NEW ORDER!\n\nOrder ID: ${orderCreationId}\n\nCustomer Details:\nName: ${customerDetails.name}\nEmail: ${customerDetails.email}\nPhone: ${customerDetails.phone}\nAddress: ${customerDetails.address}, ${customerDetails.pincode}${locationInfo}\n\nItems:\n${itemList}\n\nTotal Amount: ₹${customerDetails.total}\n\nPayment Status: PAID\nPayment ID: ${razorpayPaymentId}\n\nCheck Admin Dashboard for full details.`
        );

        res.json({ 
            message: "Payment Successful", 
            orderId: newOrder._id 
        });

    } catch (error) { 
        console.error('Payment Verification Error:', error);
        res.status(500).json({ error: "Verification Error" }); 
    }
});

// --- SERVICE REQUESTS ---

// Submit Request (User)
app.post('/api/requests', async (req, res) => {
    try {
        const { customerName, email, type, message, location } = req.body;

        // Validation
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
            location: location || null
        });
        await newRequest.save();

        // Email Admin with location link if available
        let locationInfo = '';
        if (location && location.latitude && location.longitude) {
            const gmapsLink = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
            locationInfo = `\n\n📍 Customer Location (Google Maps):\n${gmapsLink}`;
        }

        await sendEmail(
            process.env.EMAIL_USER, 
            `🔔 NEW ${type.toUpperCase()} REQUEST - ${customerName}`, 
            `NEW SERVICE REQUEST RECEIVED\n\nType: ${type}\nFrom: ${customerName}\nEmail: ${email}\n\nMessage:\n${message}${locationInfo}\n\nPlease check the admin dashboard for details.`
        );

        console.log(`✅ Service request created: ${newRequest._id}`);
        res.json(newRequest);
        
    } catch (e) { 
        console.error('Create Request Error:', e);
        res.status(500).json({ error: "Error saving request" }); 
    }
});

// Get All Requests (Admin)
app.get('/api/admin/requests', async (req, res) => {
    try {
        const requests = await Request.find().sort({ date: -1 });
        res.json(requests);
    } catch (e) { 
        console.error('Fetch Requests Error:', e);
        res.status(500).json({ error: "Fetch Error" }); 
    }
});

// Delete Request (Admin)
app.delete('/api/requests/:id', async (req, res) => {
    try {
        const deleted = await Request.findByIdAndDelete(req.params.id);
        
        if (!deleted) {
            return res.status(404).json({ error: "Request not found" });
        }

        console.log(`✅ Request deleted: ${req.params.id}`);
        res.json({ message: "Request Deleted" });
        
    } catch (e) { 
        console.error('Delete Request Error:', e);
        res.status(500).json({ error: "Delete failed" }); 
    }
});

// Mark Request Solved (Admin)
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

        console.log(`✅ Request marked solved: ${req.params.id}`);
        res.json({ message: "Request Marked Solved" });
        
    } catch (e) { 
        console.error('Solve Request Error:', e);
        res.status(500).json({ error: "Update failed" }); 
    }
});

// --- ORDER MANAGEMENT ---

// Get All Orders (Admin)
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ date: -1 });
        res.json(orders);
    } catch (e) {
        console.error('Fetch Orders Error:', e);
        res.status(500).json({ error: "Fetch failed" });
    }
});

// Mark Order Delivered (Admin)
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

        console.log(`✅ Order marked delivered: ${req.params.id}`);
        res.json({ message: "Order marked as delivered" });
        
    } catch (e) {
        console.error('Deliver Order Error:', e);
        res.status(500).json({ error: "Update failed" });
    }
});

// Cancel Order with Refund (Customer)
app.patch('/api/orders/:id/cancel', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        // Only allow cancellation if order is still processing
        if (order.status !== 'Processing') {
            return res.status(400).json({ 
                error: "Only orders in 'Processing' status can be cancelled" 
            });
        }

        // Restore stock for cancelled items
        if (order.items && order.items.length > 0) {
            for (const item of order.items) {
                if (item._id && item.qty) {
                    await Product.findByIdAndUpdate(item._id, { 
                        $inc: { stock: item.qty } 
                    });
                    console.log(`✅ Stock restored: ${item.name} (+${item.qty})`);
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

        // Send email notifications
        await sendEmail(
            order.email,
            '🔄 Order Cancellation - Refund Processing',
            `Dear ${order.customer},\n\nYour order #${order.razorpay_order_id.substr(-8)} has been cancelled as requested.\n\nRefund Amount: ₹${order.total}\n\nThe refund will be processed to your original payment method within 7 business days.\n\nIf you have any questions, please contact our support team.\n\nThank you,\nBNG Surveillance Team`
        );

        await sendEmail(
            process.env.EMAIL_USER,
            `❌ Order Cancelled - Refund Required`,
            `ORDER CANCELLATION ALERT\n\nOrder ID: ${order.razorpay_order_id}\nCustomer: ${order.customer}\nEmail: ${order.email}\nAmount: ₹${order.total}\n\nAction Required: Process refund within 7 days\n\nItems returned to stock successfully.`
        );

        console.log(`✅ Order cancelled & refund initiated: ${req.params.id}`);
        res.json({ 
            message: "Order cancelled. Refund will be processed within 7 business days.",
            order: updated
        });
        
    } catch (e) {
        console.error('Cancel Order Error:', e);
        res.status(500).json({ error: "Cancellation failed" });
    }
});

// Get User Orders
app.get('/api/my-orders', async (req, res) => {
    try {
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({ error: "Email is required" });
        }

        const orders = await Order.find({ email }).sort({ date: -1 });
        res.json(orders);
        
    } catch (e) {
        console.error('Fetch User Orders Error:', e);
        res.status(500).json({ error: "Fetch failed" });
    }
});

// ================================================================
// 7. ERROR HANDLING
// ================================================================

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ 
        error: "Route not found",
        path: req.path 
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled Error:', err);
    
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
    }
    
    res.status(500).json({ 
        error: "Internal Server Error",
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ================================================================
// 8. GRACEFUL SHUTDOWN
// ================================================================

process.on('SIGTERM', async () => {
    console.log('⚠️ SIGTERM received. Closing server gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('⚠️ SIGINT received. Closing server gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

// ================================================================
// 9. SERVER START
// ================================================================
module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║  🛡️  BNG SURVEILLANCE - COMMAND CENTER ACTIVE               ║
║                                                              ║
║  🚀 Server Running on Port: ${PORT}                         ║
║  📊 Environment: ${process.env.NODE_ENV || 'development'}                     ║
║  🔐 Database: ${mongoose.connection.readyState === 1 ? 'Connected ✅' : 'Pending ⏳'}              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
        `);
    });
}