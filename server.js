const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { MongoClient, ObjectId } = require('mongodb');

// MongoDB Configuration
const MONGODB_URI = 'mongodb+srv://Harini:Harini%40123@sharedcluster.c5jw4tz.mongodb.net/auth_system?retryWrites=true&w=majority&appName=SharedCluster';
const DB_NAME = 'auth_system';
const COLLECTION_USERS = 'users';
const COLLECTION_SESSIONS = 'sessions';

let db = null;
let client = null;
let usersCollection = null;
let sessionsCollection = null;

// Initialize MongoDB connection with better error handling
async function initializeDatabase() {
    try {
        console.log('🔗 Attempting to connect to MongoDB Atlas...');
        console.log('📡 Cluster: sharedcluster.c5jw4tz.mongodb.net');
        console.log('👤 Username: Harini');
        console.log('💾 Database: auth_system');
        
        client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
            maxPoolSize: 10,
            minPoolSize: 1,
            retryWrites: true,
            retryReads: true
        });

        // Test connection
        await client.connect();
        console.log('✅ MongoDB connection established');
        
        // Verify connection
        await client.db('admin').command({ ping: 1 });
        console.log('✅ Database ping successful');
        
        // Initialize database and collections
        db = client.db(DB_NAME);
        usersCollection = db.collection(COLLECTION_USERS);
        sessionsCollection = db.collection(COLLECTION_SESSIONS);
        
        // Create indexes
        await usersCollection.createIndex({ email: 1 }, { unique: true });
        await sessionsCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 });
        await sessionsCollection.createIndex({ userId: 1 });
        
        console.log('✅ Database indexes created');
        console.log('🎉 MongoDB Atlas is ready!');
        
        return true;
        
    } catch (error) {
        console.error('❌ MongoDB Connection Failed:');
        console.error('   Error:', error.message);
        console.error('   Code:', error.code);
        console.error('   Name:', error.name);
        
        if (error.code === 'ENOTFOUND') {
            console.log('💡 Check your internet connection');
        } else if (error.code === 'ETIMEOUT') {
            console.log('💡 Connection timeout. Check firewall settings');
        } else if (error.code === 'ECONNREFUSED') {
            console.log('💡 Connection refused. Check MongoDB Atlas IP whitelist');
        }
        
        return false;
    }
}

// Create server
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    console.log(`${new Date().toISOString()} - ${req.method} ${pathname}`);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Serve f.html as the main page
    if (pathname === '/' || pathname === '/f.html') {
        serveFPage(res);
        return;
    }
    
    // API routes
    if (pathname === '/api/signup' && req.method === 'POST') {
        await handleSignup(req, res);
        return;
    }
    
    if (pathname === '/api/login' && req.method === 'POST') {
        await handleLogin(req, res);
        return;
    }
    
    if (pathname === '/api/logout' && req.method === 'POST') {
        await handleLogout(req, res);
        return;
    }
    
    if (pathname === '/api/users' && req.method === 'GET') {
        await handleGetUsers(req, res);
        return;
    }
    
    if (pathname === '/api/verify' && req.method === 'GET') {
        await handleVerify(req, res);
        return;
    }
    
    if (pathname === '/api/status' && req.method === 'GET') {
        await handleStatus(req, res);
        return;
    }
    
    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Route not found' }));
});

function serveFPage(res) {
    const filePath = path.join(__dirname, 'f.html');
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'f.html file not found' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
    });
}

async function handleSignup(req, res) {
    try {
        const body = await getRequestBody(req);
        const { name, email, password } = body;
        
        // Validation
        if (!name || !email || !password) {
            sendError(res, 400, 'All fields are required');
            return;
        }
        
        if (!validateEmail(email)) {
            sendError(res, 400, 'Invalid email format');
            return;
        }
        
        if (!validatePassword(password)) {
            sendError(res, 400, 'Password must be at least 8 characters with uppercase, lowercase and number');
            return;
        }
        
        // Check if user already exists
        const existingUser = await usersCollection.findOne({ email: email.toLowerCase().trim() });
        if (existingUser) {
            sendError(res, 400, 'User already exists');
            return;
        }
        
        // Create user object
        const user = {
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: password, // In production, hash this with bcrypt
            createdAt: new Date(),
            updatedAt: new Date(),
            lastLogin: null,
            loginCount: 0
        };
        
        // Save to MongoDB
        const result = await usersCollection.insertOne(user);
        const savedUser = await usersCollection.findOne({ _id: result.insertedId });
        
        console.log('✅ User created in MongoDB:', savedUser.email);
        
        sendSuccess(res, { 
            message: 'User created successfully!',
            user: { 
                id: savedUser._id.toString(), 
                name: savedUser.name, 
                email: savedUser.email 
            },
            database: 'mongodb'
        });
        
    } catch (error) {
        console.error('❌ Signup error:', error);
        if (error.code === 11000) {
            sendError(res, 400, 'User already exists');
        } else {
            sendError(res, 500, 'Database error: ' + error.message);
        }
    }
}

async function handleLogin(req, res) {
    try {
        const body = await getRequestBody(req);
        const { email, password } = body;
        
        if (!email || !password) {
            sendError(res, 400, 'Email and password required');
            return;
        }
        
        // Find user in MongoDB
        const user = await usersCollection.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            sendError(res, 401, 'Invalid email or password');
            return;
        }
        
        // Check password
        if (user.password !== password) {
            sendError(res, 401, 'Invalid email or password');
            return;
        }
        
        // Update user stats
        await usersCollection.updateOne(
            { _id: user._id },
            { 
                $set: { lastLogin: new Date() },
                $inc: { loginCount: 1 }
            }
        );
        
        // Create session in MongoDB
        const session = {
            userId: user._id,
            email: user.email,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        };
        
        const sessionResult = await sessionsCollection.insertOne(session);
        const sessionId = sessionResult.insertedId.toString();
        
        console.log('✅ User logged in via MongoDB:', user.email);
        
        sendSuccess(res, { 
            message: 'Login successful!',
            user: { 
                id: user._id.toString(), 
                name: user.name, 
                email: user.email 
            },
            sessionId: sessionId,
            redirect: body.redirect || 'welcome.html',
            database: 'mongodb'
        });
        
    } catch (error) {
        console.error('❌ Login error:', error);
        sendError(res, 500, 'Database error: ' + error.message);
    }
}

async function handleLogout(req, res) {
    try {
        const cookies = parseCookies(req);
        const sessionId = cookies.sessionId;
        
        if (sessionId) {
            await sessionsCollection.deleteOne({ _id: new ObjectId(sessionId) });
            console.log('✅ User logged out from MongoDB');
        }
        
        sendSuccess(res, { message: 'Logged out successfully' });
        
    } catch (error) {
        console.error('❌ Logout error:', error);
        sendError(res, 500, 'Database error');
    }
}

async function handleGetUsers(req, res) {
    try {
        const users = await usersCollection.find({})
            .project({ password: 0 })
            .sort({ createdAt: -1 })
            .toArray();
            
        sendSuccess(res, { 
            users: users.map(user => ({
                ...user,
                id: user._id.toString()
            })),
            total: users.length,
            database: 'mongodb'
        });
        
    } catch (error) {
        console.error('❌ Get users error:', error);
        sendError(res, 500, 'Database error');
    }
}

async function handleVerify(req, res) {
    try {
        const cookies = parseCookies(req);
        const sessionId = cookies.sessionId;
        
        if (!sessionId) {
            sendSuccess(res, { authenticated: false });
            return;
        }
        
        const session = await sessionsCollection.findOne({ 
            _id: new ObjectId(sessionId),
            expiresAt: { $gt: new Date() }
        });
        
        if (session) {
            const user = await usersCollection.findOne({ _id: session.userId });
            if (user) {
                sendSuccess(res, { 
                    authenticated: true,
                    user: { 
                        id: user._id.toString(), 
                        name: user.name, 
                        email: user.email 
                    }
                });
                return;
            }
        }
        
        sendSuccess(res, { authenticated: false });
        
    } catch (error) {
        console.error('❌ Verify error:', error);
        sendSuccess(res, { authenticated: false });
    }
}

async function handleStatus(req, res) {
    try {
        const userCount = await usersCollection.countDocuments();
        const sessionCount = await sessionsCollection.countDocuments({
            expiresAt: { $gt: new Date() }
        });
        
        sendSuccess(res, {
            status: 'connected',
            database: 'mongodb',
            cluster: 'SharedCluster',
            stats: {
                totalUsers: userCount,
                activeSessions: sessionCount,
                serverTime: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Status error:', error);
        sendError(res, 500, 'Database error');
    }
}

// Utility functions
function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
}

function parseCookies(req) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return {};
    return cookieHeader.split(';').reduce((cookies, cookie) => {
        const [name, value] = cookie.trim().split('=');
        cookies[name] = value;
        return cookies;
    }, {});
}

function sendSuccess(res, data) {
    const response = { success: true, ...data };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
}

function sendError(res, code, message) {
    const response = { success: false, error: message };
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
}

// Start server
const PORT = 3000;

async function startServer() {
    console.log('🚀 Starting Authentication Server...\n');
    
    const dbConnected = await initializeDatabase();
    
    if (!dbConnected) {
        console.log('\n❌ CANNOT START: MongoDB connection failed');
        console.log('💡 Please check:');
        console.log('   1. Internet connection');
        console.log('   2. MongoDB Atlas IP whitelist (allow all IPs: 0.0.0.0/0)');
        console.log('   3. Database user credentials');
        console.log('   4. Cluster status in MongoDB Atlas dashboard');
        process.exit(1);
    }
    
    server.listen(PORT, () => {
        console.log(`\n🎉 AUTHENTICATION SERVER STARTED SUCCESSFULLY!`);
        console.log(`✅ Server: http://localhost:${PORT}`);
        console.log(`🗄️  Database: MongoDB Atlas ☁️`);
        console.log(`🎯 Cluster: SharedCluster`);
        console.log(`👤 User: Harini`);
        console.log(`💾 Database: auth_system`);
        console.log(`📊 Collections: users, sessions`);
        console.log(`🔗 Status: http://localhost:${PORT}/api/status`);
        console.log(`👥 Users: http://localhost:${PORT}/api/users`);
        console.log(`🌐 Login: http://localhost:${PORT}`);
        console.log(`\n🚀 Ready to accept user registrations!`);
    });
}

process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down server...');
    if (client) {
        await client.close();
        console.log('✅ MongoDB connection closed');
    }
    process.exit(0);
});

startServer().catch(console.error);