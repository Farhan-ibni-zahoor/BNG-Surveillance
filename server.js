// ================================================================
// BNG SURVEILLANCE - COMPLETE BACKEND SERVER
// Features: Auto WhatsApp, Multiple Images, Phone Required
// ================================================================

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const Razorpay = require('razorpay');

const app = express();
const PORT = process.env.PORT || 5000;

// ================================================================
// MIDDLEWARE
// ================================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// ================================================================
// DATABASE CONNECTION
// ================================================================
mongoose.connect('mongodb://localhost:27017/bng_surveillance', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err));

// ================================================================
// RAZORPAY CONFIGURATION
// ================================================================
const razorpay = new Razorpay({
    key_id: 'rzp_test_your_key_here',
    key_secret: 'your_secret_here'
});

// ================================================================
// EMAIL CONFIGURATION (with spam folder notice)
// ================================================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'your_email@gmail.com',
        pass: 'your_app_password'
    }
});

// ================================================================
// FILE UPLOAD CONFIGURATION (Multiple Images)
// ================================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    }
});

// ================================================================
// DATABASE MODELS
// ================================================================

// User Schema
const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'customer' },
    otp: String,
    otpExpiry: Date,
    verified: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// Product Schema with Multiple Images
const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    image: { type: String, required: true }, // Main image (first one)
    images: [{ type: String }], // Array of all images
    desc: { type: String, required: true },
    reviews: [{ 
        user: String, 
        comment: String, 
        date: { type: Date, default: Date.now } 
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Order Schema with Phone Number
const OrderSchema = new mongoose.Schema({
    customer: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true }, // Phone number required
    address: { type: String, required: true },
    pincode: { type: String, required: true },
    items: [{
        productId: String,
        name: String,
        price: Number,
        qty: Number,
        image: String
    }],
    total: { type: Number, required: true },
    location: {
        latitude: Number,
        longitude: Number
    },
    paymentId: String,
    orderId: String,
    status: { type: String, default: 'Processing' },
    date: { type: Date, default: Date.now },
    cancelledAt: Date,
    refundProcessed: { type: Boolean, default: false }
});

// Support Request Schema with Phone Number
const RequestSchema = new mongoose.Schema({
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true }, // Phone number required
    type: { type: String, required: true },
    message: { type: String, required: true },
    location: {
        latitude: Number,
        longitude: Number
    },
    status: { type: String, default: 'Pending' },
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);
const Request = mongoose.model('Request', RequestSchema);

// ================================================================
// HELPER FUNCTIONS
// ================================================================

// Generate OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send Email with Spam Folder Notice
async function sendEmail(to, subject, html) {
    const mailOptions = {
        from: '"BNG Surveillance" <your_email@gmail.com>',
        to: to,
        subject: subject,
        html: html
    };
    
    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Email Error:', error);
        return false;
    }
}

// Generate WhatsApp URL with Order Details
function generateWhatsAppNotification(orderData) {
    const adminPhone = '916006750581';
    
    let message = `*🔔 NEW ORDER RECEIVED*\n\n`;
    message += `*Order ID:* #${orderData.orderId.substr(-8)}\n`;
    message += `*Customer:* ${orderData.customer}\n`;
    message += `*Phone:* ${orderData.phone}\n`;
    message += `*Email:* ${orderData.email}\n\n`;
    
    message += `*📦 ITEMS:*\n`;
    orderData.items.forEach((item, index) => {
        message += `${index + 1}. ${item.name}\n`;
        message += `   Qty: ${item.qty} × ₹${item.price.toLocaleString()}\n`;
    });
    
    message += `\n*💰 Total Amount:* ₹${orderData.total.toLocaleString()}\n\n`;
    
    message += `*📍 DELIVERY ADDRESS:*\n`;
    message += `${orderData.address}\n`;
    message += `Pincode: ${orderData.pincode}\n\n`;
    
    if (orderData.location && orderData.location.latitude) {
        const mapsLink = `https://www.google.com/maps?q=${orderData.location.latitude},${orderData.location.longitude}`;
        message += `*🗺️ Live Location:*\n${mapsLink}\n\n`;
    }
    
    message += `*Payment ID:* ${orderData.paymentId}\n`;
    message += `*Date:* ${new Date().toLocaleString('en-IN')}`;
    
    const encodedMessage = encodeURIComponent(message);
    return `https://wa.me/${adminPhone}?text=${encodedMessage}`;
}

// ================================================================
// AUTHENTICATION ROUTES
// ================================================================

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        const otp = generateOTP();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        
        const user = new User({
            name,
            email,
            password,
            otp,
            otpExpiry,
            verified: false
        });
        
        await user.save();
        
        // Send OTP Email with Spam Notice
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc; border-radius: 10px;">
                <div style="background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0;">BNG Surveillance</h1>
                    <p style="color: white; margin: 10px 0 0 0;">Email Verification</p>
                </div>
                
                <div style="background: white; padding: 40px; border-radius: 0 0 10px 10px;">
                    <h2 style="color: #1e293b; margin-top: 0;">Hi ${name}!</h2>
                    <p style="color: #64748b; font-size: 16px; line-height: 1.6;">
                        Thank you for registering with BNG Surveillance. Please use the code below to verify your email address:
                    </p>
                    
                    <div style="background: #f1f5f9; border-left: 4px solid #0ea5e9; padding: 20px; margin: 25px 0; text-align: center;">
                        <div style="color: #64748b; font-size: 14px; margin-bottom: 10px;">Your Verification Code</div>
                        <div style="font-size: 36px; font-weight: bold; color: #0ea5e9; letter-spacing: 8px;">${otp}</div>
                        <div style="color: #64748b; font-size: 12px; margin-top: 10px;">Valid for 10 minutes</div>
                    </div>
                    
                    <div style="background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
                        <p style="margin: 0; color: #1e40af; font-size: 14px;">
                            <strong>📧 Important:</strong> Please check your <strong>spam/junk folder</strong> if you don't see this email in your inbox.
                        </p>
                    </div>
                    
                    <p style="color: #64748b; font-size: 14px; margin-top: 30px;">
                        If you didn't request this verification, please ignore this email.
                    </p>
                    
                    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px;">
                        <p>© 2024 BNG Surveillance Systems. All rights reserved.</p>
                    </div>
                </div>
            </div>
        `;
        
        await sendEmail(email, 'Verify Your Email - BNG Surveillance', emailHtml);
        
        res.json({ message: 'OTP sent to email. Please check spam folder if not in inbox.' });
        
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (user.verified) {
            return res.status(400).json({ error: 'Email already verified' });
        }
        
        if (user.otp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }
        
        if (new Date() > user.otpExpiry) {
            return res.status(400).json({ error: 'OTP expired' });
        }
        
        user.verified = true;
        user.otp = undefined;
        user.otpExpiry = undefined;
        await user.save();
        
        res.json({ message: 'Email verified successfully' });
        
    } catch (error) {
        console.error('OTP Verification Error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ email, password });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        if (!user.verified) {
            return res.status(403).json({ error: 'Please verify your email first' });
        }
        
        res.json({
            name: user.name,
            email: user.email,
            role: user.role
        });
        
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ================================================================
// PRODUCT ROUTES (Multiple Images Support)
// ================================================================

// Get all products
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        res.json(products);
    } catch (error) {
        console.error('Product Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// Add product with multiple images
app.post('/api/products', upload.array('images', 10), async (req, res) => {
    try {
        const { name, category, price, stock, desc } = req.body;
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'At least one image is required' });
        }
        
        // Generate URLs for all uploaded images
        const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
        
        const product = new Product({
            name,
            category,
            price: Number(price),
            stock: Number(stock),
            desc,
            image: imageUrls[0], // First image as main image
            images: imageUrls // All images array
        });
        
        await product.save();
        res.json(product);
        
    } catch (error) {
        console.error('Product Add Error:', error);
        res.status(500).json({ error: 'Failed to add product' });
    }
});

// Update product with optional new images
app.put('/api/products/:id', upload.array('images', 10), async (req, res) => {
    try {
        const { name, category, price, stock, desc } = req.body;
        
        const updateData = {
            name,
            category,
            price: Number(price),
            stock: Number(stock),
            desc,
            updatedAt: new Date()
        };
        
        // If new images are uploaded, replace all existing images
        if (req.files && req.files.length > 0) {
            const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
            updateData.image = imageUrls[0];
            updateData.images = imageUrls;
        }
        
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        );
        
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        res.json(product);
        
    } catch (error) {
        console.error('Product Update Error:', error);
        res.status(500).json({ error: 'Failed to update product' });
    }
});

// Delete product
app.delete('/api/products/:id', async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Product Delete Error:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// Add review
app.post('/api/review/:id', async (req, res) => {
    try {
        const { user, comment } = req.body;
        const product = await Product.findById(req.params.id);
        
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        product.reviews.push({ user, comment });
        await product.save();
        
        res.json(product);
    } catch (error) {
        console.error('Review Error:', error);
        res.status(500).json({ error: 'Failed to add review' });
    }
});

// ================================================================
// ORDER ROUTES (Auto WhatsApp Notification)
// ================================================================

// Create Razorpay Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body;
        
        const options = {
            amount: amount * 100, // Convert to paise
            currency: 'INR',
            receipt: 'order_' + Date.now()
        };
        
        const order = await razorpay.orders.create(options);
        res.json(order);
        
    } catch (error) {
        console.error('Razorpay Order Error:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// Verify Payment and AUTO SEND WHATSAPP
app.post('/api/verify-payment', async (req, res) => {
    try {
        const { orderCreationId, razorpayPaymentId, razorpaySignature, customerDetails } = req.body;
        
        // Verify signature
        const shasum = crypto.createHmac('sha256', 'your_razorpay_secret');
        shasum.update(`${orderCreationId}|${razorpayPaymentId}`);
        const digest = shasum.digest('hex');
        
        if (digest !== razorpaySignature) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }
        
        // Create order in database
        const order = new Order({
            customer: customerDetails.name,
            email: customerDetails.email,
            phone: customerDetails.phone, // Phone number saved
            address: customerDetails.address,
            pincode: customerDetails.pincode,
            items: customerDetails.items.map(item => ({
                productId: item._id,
                name: item.name,
                price: item.price,
                qty: item.qty,
                image: (item.images && item.images[0]) || item.image
            })),
            total: customerDetails.total,
            location: customerDetails.location,
            paymentId: razorpayPaymentId,
            orderId: orderCreationId,
            status: 'Processing'
        });
        
        await order.save();
        
        // Update stock
        for (const item of customerDetails.items) {
            await Product.findByIdAndUpdate(item._id, {
                $inc: { stock: -item.qty }
            });
        }
        
        // Generate WhatsApp URL with all order details
        const whatsappUrl = generateWhatsAppNotification({
            orderId: orderCreationId,
            customer: customerDetails.name,
            email: customerDetails.email,
            phone: customerDetails.phone,
            address: customerDetails.address,
            pincode: customerDetails.pincode,
            items: customerDetails.items,
            total: customerDetails.total,
            location: customerDetails.location,
            paymentId: razorpayPaymentId
        });
        
        // Send confirmation email to customer
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%); padding: 30px; text-align: center;">
                    <h1 style="color: white; margin: 0;">Order Confirmed!</h1>
                </div>
                <div style="padding: 30px; background: #f8fafc;">
                    <p>Hi ${customerDetails.name},</p>
                    <p>Your order has been confirmed! Order ID: <strong>#${orderCreationId.substr(-8)}</strong></p>
                    <p>Total Amount: <strong>₹${customerDetails.total.toLocaleString()}</strong></p>
                    <p>We've automatically notified our team, and they will contact you shortly at <strong>${customerDetails.phone}</strong>.</p>
                    <p style="margin-top: 30px;">Thank you for choosing BNG Surveillance!</p>
                </div>
            </div>
        `;
        
        await sendEmail(customerDetails.email, 'Order Confirmed - BNG Surveillance', emailHtml);
        
        // Return WhatsApp URL to frontend for automatic opening
        res.json({
            message: 'Payment verified successfully',
            orderId: order._id,
            whatsappUrl: whatsappUrl // Frontend will auto-open this
        });
        
    } catch (error) {
        console.error('Payment Verification Error:', error);
        res.status(500).json({ error: 'Payment verification failed' });
    }
});

// Get user orders
app.get('/api/my-orders', async (req, res) => {
    try {
        const { email } = req.query;
        const orders = await Order.find({ email }).sort({ date: -1 });
        res.json(orders);
    } catch (error) {
        console.error('Orders Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Get all orders (admin)
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ date: -1 });
        res.json(orders);
    } catch (error) {
        console.error('Orders Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Cancel order
app.patch('/api/orders/:id/cancel', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        if (order.status !== 'Processing') {
            return res.status(400).json({ error: 'Order cannot be cancelled' });
        }
        
        // Restore stock
        for (const item of order.items) {
            await Product.findByIdAndUpdate(item.productId, {
                $inc: { stock: item.qty }
            });
        }
        
        order.status = 'Refund Processing';
        order.cancelledAt = new Date();
        await order.save();
        
        res.json(order);
        
    } catch (error) {
        console.error('Order Cancel Error:', error);
        res.status(500).json({ error: 'Failed to cancel order' });
    }
});

// Mark order as delivered
app.patch('/api/orders/:id/deliver', async (req, res) => {
    try {
        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { status: 'Delivered' },
            { new: true }
        );
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json(order);
    } catch (error) {
        console.error('Order Update Error:', error);
        res.status(500).json({ error: 'Failed to update order' });
    }
});

// ================================================================
// SUPPORT REQUEST ROUTES (Phone Required)
// ================================================================

// Create support request
app.post('/api/requests', async (req, res) => {
    try {
        const { customerName, email, phone, type, message, location } = req.body;
        
        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }
        
        const request = new Request({
            customerName,
            email,
            phone,
            type,
            message,
            location
        });
        
        await request.save();
        res.json(request);
        
    } catch (error) {
        console.error('Request Error:', error);
        res.status(500).json({ error: 'Failed to create request' });
    }
});

// Get all support requests (admin)
app.get('/api/admin/requests', async (req, res) => {
    try {
        const requests = await Request.find().sort({ date: -1 });
        res.json(requests);
    } catch (error) {
        console.error('Requests Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

// Mark request as solved
app.patch('/api/requests/:id/solve', async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            { status: 'Solved' },
            { new: true }
        );
        
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }
        
        res.json(request);
    } catch (error) {
        console.error('Request Update Error:', error);
        res.status(500).json({ error: 'Failed to update request' });
    }
});

// Delete request
app.delete('/api/requests/:id', async (req, res) => {
    try {
        const request = await Request.findByIdAndDelete(req.params.id);
        
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }
        
        res.json({ message: 'Request deleted successfully' });
    } catch (error) {
        console.error('Request Delete Error:', error);
        res.status(500).json({ error: 'Failed to delete request' });
    }
});

// ================================================================
// SERVER START
// ================================================================

app.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════════════════════╗
    ║   🛡️  BNG SURVEILLANCE SERVER RUNNING              ║
    ║                                                    ║
    ║   Port: ${PORT}                                      ║
    ║   Status: ✅ Active                                ║
    ║                                                    ║
    ║   Features Enabled:                                ║
    ║   ✅ Auto WhatsApp Notifications                   ║
    ║   ✅ Multiple Product Images                       ║
    ║   ✅ Phone Number Required                         ║
    ║   ✅ Live Location Tracking                        ║
    ║   ✅ Email with Spam Notice                        ║
    ║                                                    ║
    ╚════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
