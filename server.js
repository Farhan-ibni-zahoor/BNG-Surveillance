// 1. IMPORTS
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
const nodemailer = require('nodemailer'); // Now Active

// 2. CONFIGURATION
const app = express();
const PORT = process.env.PORT || 5000;

// 3. CLOUDINARY CONFIGURATION
cloudinary.config({ 
    cloud_name: process.env.CLOUD_NAME, 
    api_key: process.env.CLOUD_API_KEY, 
    api_secret: process.env.CLOUD_API_SECRET 
});

// 4. RAZORPAY KEYS
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// 5. EMAIL CONFIGURATION (NODEMAILER)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// 6. DATABASE CONNECTION
const DB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bng-surveillance';
mongoose.connect(DB_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ DB Error:", err));

// 7. MIDDLEWARE
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 8. SCHEMAS
const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: { type: String, required: false },
    isVerified: { type: Boolean, default: false }, // Default is false
    otp: String,
    role: { type: String, default: 'customer' }
});

const ProductSchema = new mongoose.Schema({
    name: String,
    category: String,
    price: Number,
    image: String,
    desc: String,
    reviews: [{ user: String, comment: String, date: { type: Date, default: Date.now } }]
});

const OrderSchema = new mongoose.Schema({
    razorpay_order_id: String,
    payment_status: String,
    customer: String,
    email: String,
    phone: String,
    address: String,
    pincode: String,
    items: Array,
    total: Number,
    status: { type: String, default: 'Processing' },
    date: { type: Date, default: Date.now }
});

const RequestSchema = new mongoose.Schema({
    customerName: String,
    email: String,
    type: String,
    message: String,
    status: { type: String, default: 'Open' },
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Product = mongoose.model('Product', ProductSchema);
const Order = mongoose.model('Order', OrderSchema);
const Request = mongoose.model('Request', RequestSchema);

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- ROUTES ---

// AUTH: REGISTER (UPDATED WITH OTP)
app.post('/api/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ error: "Email already registered" });

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        const newUser = new User({ 
            name, 
            email, 
            password, 
            otp, 
            isVerified: false // User is not verified yet
        });
        
        await newUser.save();

        // Send Email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Verify Your Account - BNG Surveillance',
            text: `Your Verification OTP is: ${otp}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log(error);
                return res.status(500).json({ error: "Error sending email" });
            }
            res.json({ message: "Registration successful. Check email for OTP." });
        });

    } catch (err) {
        res.status(500).json({ error: "Registration Failed" });
    }
});

// AUTH: VERIFY OTP
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(400).json({ error: "User not found" });

        if (user.otp === otp) {
            user.isVerified = true;
            user.otp = null; // Clear OTP after usage
            await user.save();
            res.json({ message: "Email verified successfully. You can now login." });
        } else {
            res.status(400).json({ error: "Invalid OTP" });
        }
    } catch (e) {
        res.status(500).json({ error: "Verification failed" });
    }
});

// AUTH: LOGIN (UPDATED TO CHECK VERIFICATION)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    // Admin Override
    if(email === "bngsurveillance@gmail.com" && password === "Surveillance@0627") {
        return res.json({ name: "Farhan (Admin)", email, role: "author", phone: "6006750581" }); 
    }
    
    try {
        const user = await User.findOne({ email, password });
        if(!user) return res.status(401).json({ error: "Invalid Credentials" });

        // Check if verified
        if(!user.isVerified) {
            return res.status(403).json({ error: "Account not verified. Please verify OTP." });
        }

        res.json(user);
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// ... (KEEP ALL OTHER ROUTES THE SAME: Products, Orders, Requests, Razorpay) ...

// PRODUCTS: GET ALL
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PRODUCTS: ADD NEW (Admin)
app.post('/api/products', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image file uploaded" });

        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: 'bng_surveillance', resource_type: 'image' },
            async (error, result) => {
                if (error) return res.status(500).json({ error: "Cloudinary Upload Failed" });

                const { name, category, price, desc } = req.body;
                const newProduct = new Product({ 
                    name, category, price: Number(price), 
                    image: result.secure_url, desc, reviews: [] 
                });
                await newProduct.save();
                res.json(newProduct);
            }
        );
        streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

// REVIEWS
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

// RAZORPAY ROUTES
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount } = req.body; 
        const options = { amount: amount * 100, currency: "INR", receipt: "receipt_" + Date.now() };
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (error) { res.status(500).json({ error: "Razorpay Error" }); }
});

app.post('/api/verify-payment', async (req, res) => {
    const { orderCreationId, razorpayPaymentId, razorpaySignature, customerDetails } = req.body;
    try {
        const shasum = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
        shasum.update(`${orderCreationId}|${razorpayPaymentId}`);
        if (shasum.digest("hex") !== razorpaySignature) return res.status(400).json({ message: "Invalid Transaction" });

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
        res.json({ message: "Payment Successful", orderId: newOrder._id });
    } catch (error) { res.status(500).json({ error: "Verification Error" }); }
});

// ADMIN & REQUEST ROUTES
app.post('/api/requests', async (req, res) => {
    try {
        const newRequest = new Request(req.body);
        await newRequest.save();
        res.json(newRequest);
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

app.get('/api/orders', async (req, res) => {
    const orders = await Order.find().sort({ date: -1 });
    res.json(orders);
});

app.patch('/api/orders/:id/deliver', async (req, res) => {
    await Order.findByIdAndUpdate(req.params.id, { status: 'Delivered' });
    res.json({ message: "Order marked as delivered" });
});

app.get('/api/my-orders', async (req, res) => {
    const { email } = req.query;
    const orders = await Order.find({ email }).sort({ date: -1 });
    res.json(orders);
});

app.listen(PORT, () => console.log(`🚀 BNG Server Active on Port ${PORT}`));