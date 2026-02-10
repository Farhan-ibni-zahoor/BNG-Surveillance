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

// Helper: Safe Email Sending
const sendEmail = async (to, subject, text) => {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject,
            text: text
        });
        console.log(`✅ Email sent successfully to: ${to}`);
    } catch (error) {
        console.error(`❌ FAILED to send email to ${to}:`, error.message);
    }
};

// Database Connection
const DB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bng-surveillance';
mongoose.connect(DB_URI)
    .then(() => console.log("✅ MongoDB Database Connected Successfully"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================================================================
// 3. DATABASE SCHEMAS (MODELS)
// ================================================================

// User Model
const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: { type: String, required: false },
    isVerified: { type: Boolean, default: false },
    otp: String,
    role: { type: String, default: 'customer' } // 'customer' or 'author'
});

// Product Model (Added Stock)
const ProductSchema = new mongoose.Schema({
    name: String,
    category: String,
    price: Number,
    stock: { type: Number, default: 0 }, // Tracks inventory count
    image: String,
    desc: String,
    reviews: [{ 
        user: String, 
        comment: String, 
        date: { type: Date, default: Date.now } 
    }]
});

// Order Model
const OrderSchema = new mongoose.Schema({
    razorpay_order_id: String,
    payment_status: String,
    customer: String,
    email: String,
    phone: String,
    address: String,
    pincode: String,
    items: Array, // Stores snapshot of items bought
    total: Number,
    status: { type: String, default: 'Processing' }, // Processing -> Delivered
    date: { type: Date, default: Date.now }
});

// Service Request Model
const RequestSchema = new mongoose.Schema({
    customerName: String,
    email: String,
    type: String, // 'Service' or 'Issue'
    message: String,
    status: { type: String, default: 'Open' }, // Open -> Solved
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);
const Request = mongoose.model('Request', RequestSchema);

// Setup File Upload
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ================================================================
// 4. API ROUTES
// ================================================================

// --- AUTHENTICATION ---

// Register User
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        let user = await User.findOne({ email });
        
        // Prevent re-registering verified users
        if (user && user.isVerified) {
            return res.status(400).json({ error: "Email already registered" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        if (user && !user.isVerified) {
            // Update existing unverified user
            user.name = name;
            user.password = password;
            user.otp = otp;
            await user.save();
        } else {
            // Create new user
            user = new User({ name, email, password, otp, isVerified: false });
            await user.save();
        }

        // Email OTP
        await sendEmail(email, 'Verify Your Account - BNG Surveillance', `Your Verification OTP is: ${otp}`);
        
        res.json({ message: "Verification code sent to email." });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Registration Failed" });
    }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(400).json({ error: "User not found" });

        if (user.otp === otp) {
            user.isVerified = true;
            user.otp = null; // Clear OTP
            await user.save();
            res.json({ message: "Email verified successfully." });
        } else {
            res.status(400).json({ error: "Invalid OTP" });
        }
    } catch (e) { res.status(500).json({ error: "Verification failed" }); }
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    // HARDCODED ADMIN LOGIN (Secure this in production)
    if(email === "bngsurveillance@gmail.com" && password === "Surveillance@0627") {
        return res.json({ 
            name: "Farhan (Admin)", 
            email, 
            role: "author", 
            phone: "916006750581" 
        }); 
    }
    
    try {
        const user = await User.findOne({ email, password });
        if(!user) return res.status(401).json({ error: "Invalid Credentials" });
        if(!user.isVerified) return res.status(403).json({ error: "Account not verified. Please verify OTP." });

        res.json(user);
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// --- PRODUCT MANAGEMENT ---

// Get All Products
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add New Product (Admin)
app.post('/api/products', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image file uploaded" });

        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: 'bng_surveillance', resource_type: 'image' },
            async (error, result) => {
                if (error) return res.status(500).json({ error: "Cloudinary Upload Failed" });

                const { name, category, price, desc, stock } = req.body;
                const newProduct = new Product({ 
                    name, 
                    category, 
                    price: Number(price), 
                    stock: Number(stock), // Stock is saved here
                    image: result.secure_url, 
                    desc, 
                    reviews: [] 
                });
                await newProduct.save();
                res.json(newProduct);
            }
        );
        streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

// Edit Product (Admin - NEW FEATURE)
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
    try {
        const { name, category, price, desc, stock } = req.body;
        const updateData = {
            name,
            category,
            price: Number(price),
            stock: Number(stock),
            desc
        };

        // If new image is provided, upload it first
        if (req.file) {
            const uploadStream = cloudinary.uploader.upload_stream(
                { folder: 'bng_surveillance', resource_type: 'image' },
                async (error, result) => {
                    if (error) return res.status(500).json({ error: "Image Upload Failed" });
                    
                    updateData.image = result.secure_url;
                    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });
                    res.json(updatedProduct);
                }
            );
            streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
        } else {
            // No new image, just update data
            const updatedProduct = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });
            res.json(updatedProduct);
        }
    } catch (e) {
        res.status(500).json({ error: "Update failed" });
    }
});

// Add Review
app.post('/api/review/:id', async (req, res) => {
    try {
        const { user, comment } = req.body;
        const product = await Product.findById(req.params.id);
        if(!product) return res.status(404).json({ error: "Product not found" });
        
        product.reviews.push({ user, comment });
        await product.save();
        res.json({ message: "Review Added" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ORDER & PAYMENT PROCESSING ---

// Create Razorpay Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body; 
        const options = { 
            amount: amount * 100, // Amount in paisa
            currency: "INR", 
            receipt: "receipt_" + Date.now() 
        };
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (error) { res.status(500).json({ error: "Razorpay Error" }); }
});

// Verify Payment & Process Order
app.post('/api/verify-payment', async (req, res) => {
    const { orderCreationId, razorpayPaymentId, razorpaySignature, customerDetails } = req.body;
    try {
        const shasum = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
        shasum.update(`${orderCreationId}|${razorpayPaymentId}`);
        
        if (shasum.digest("hex") !== razorpaySignature) {
            return res.status(400).json({ message: "Invalid Transaction" });
        }

        // 1. DEDUCT STOCK
        if (customerDetails.items && customerDetails.items.length > 0) {
            for (const item of customerDetails.items) {
                if(item._id && item.qty) {
                    await Product.findByIdAndUpdate(item._id, { $inc: { stock: -item.qty } });
                }
            }
        }

        // 2. SAVE ORDER
        const newOrder = new Order({
            razorpay_order_id: orderCreationId,
            payment_status: "Paid",
            customer: customerDetails.name,
            email: customerDetails.email,
            phone: customerDetails.phone,
            address: customerDetails.address,
            pincode: customerDetails.pincode,
            items: customerDetails.items,
            total: customerDetails.total,
            status: "Processing"
        });
        await newOrder.save();

        // 3. EMAIL NOTIFICATION TO ADMIN
        const itemList = customerDetails.items.map(i => `${i.qty}x ${i.name}`).join(', ');
        await sendEmail(
            process.env.EMAIL_USER, 
            `💰 NEW ORDER: ₹${customerDetails.total} - ${customerDetails.name}`, 
            `YOU HAVE A NEW ORDER!\n\nName: ${customerDetails.name}\nPhone: ${customerDetails.phone}\nAddress: ${customerDetails.address}, ${customerDetails.pincode}\n\nItems:\n${itemList}\n\nTotal: Rs.${customerDetails.total}\n\nCheck Admin Dashboard for details.`
        );

        res.json({ message: "Payment Successful", orderId: newOrder._id });

    } catch (error) { res.status(500).json({ error: "Verification Error" }); }
});

// --- SERVICE REQUESTS (ADMIN) ---

// Submit Request (User)
app.post('/api/requests', async (req, res) => {
    try {
        const newRequest = new Request(req.body);
        await newRequest.save();

        // Email Admin
        await sendEmail(
            process.env.EMAIL_USER, 
            `🔔 NEW ${req.body.type.toUpperCase()} REQUEST`, 
            `YOU HAVE A NEW REQUEST!\n\nFrom: ${req.body.customerName}\nEmail: ${req.body.email}\n\nDetails:\n${req.body.message}`
        );

        res.json(newRequest);
    } catch (e) { res.status(500).json({ error: "Error saving request" }); }
});

// Get All Requests (Admin)
app.get('/api/admin/requests', async (req, res) => {
    try {
        const requests = await Request.find().sort({ date: -1 });
        res.json(requests);
    } catch (e) { res.status(500).json({ error: "Fetch Error" }); }
});

// Delete Request (Admin)
app.delete('/api/requests/:id', async (req, res) => {
    try {
        await Request.findByIdAndDelete(req.params.id);
        res.json({ message: "Request Deleted" });
    } catch (e) { res.status(500).json({ error: "Delete failed" }); }
});

// Mark Request Solved (Admin)
app.patch('/api/requests/:id/solve', async (req, res) => {
    try {
        await Request.findByIdAndUpdate(req.params.id, { status: 'Solved' });
        res.json({ message: "Request Marked Solved" });
    } catch (e) { res.status(500).json({ error: "Update failed" }); }
});

// --- ORDER UTILS ---

// Get All Orders (Admin)
app.get('/api/orders', async (req, res) => {
    const orders = await Order.find().sort({ date: -1 });
    res.json(orders);
});

// Mark Order Delivered (Admin)
app.patch('/api/orders/:id/deliver', async (req, res) => {
    await Order.findByIdAndUpdate(req.params.id, { status: 'Delivered' });
    res.json({ message: "Order marked as delivered" });
});

// Get User Orders
app.get('/api/my-orders', async (req, res) => {
    const { email } = req.query;
    const orders = await Order.find({ email }).sort({ date: -1 });
    res.json(orders);
});

// ================================================================
// 5. SERVER START
// ================================================================
module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => console.log(`🚀 BNG Server Active on Port ${PORT}`));
}