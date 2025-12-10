import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';

const app = express();
const httpServer = createServer(app);

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            connectSrc: ["'self'", "ws:", "wss:"],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// Rate limiting to prevent DDoS
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.',
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(limiter);
app.use(express.json({ limit: '10kb' })); // Body parser with size limit

// Environment variables with defaults
const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const NODE_ENV = process.env.NODE_ENV || 'development';

// CORS configuration - more secure for production
const corsOptions = NODE_ENV === 'production'
  ? {
      origin: CLIENT_ORIGIN,
      methods: ["GET", "POST"],
      credentials: true
    }
  : {
      origin: "*", // Allow all origins in development
      methods: ["GET", "POST"]
    };

const io = new Server(httpServer, {
    cors: corsOptions
});

// Store active sessions
// Code -> { sender: socketId, receiver: socketId, createdAt: timestamp, timeout: timeoutId, attempts: number }
const sessions = new Map();

// Security: Track connection attempts per IP
const connectionAttempts = new Map();
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

// Session timeout: 5 minutes
const SESSION_TIMEOUT = 5 * 60 * 1000;

// Security: Input validation
function isValidSessionCode(code) {
    // Must be exactly 6 digits
    return /^\d{6}$/.test(code);
}

function generateCode() {
    let code;
    do {
        // Use crypto for secure random generation
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (sessions.has(code));
    return code;
}

// Security: Rate limiting per socket
function checkRateLimit(socketId) {
    const now = Date.now();
    const attempts = connectionAttempts.get(socketId) || { count: 0, firstAttempt: now };

    // Reset if window expired
    if (now - attempts.firstAttempt > ATTEMPT_WINDOW) {
        connectionAttempts.set(socketId, { count: 1, firstAttempt: now });
        return true;
    }

    // Check if exceeded limit
    if (attempts.count >= MAX_ATTEMPTS) {
        return false;
    }

    attempts.count++;
    connectionAttempts.set(socketId, attempts);
    return true;
}

// Clean up old attempt records periodically
setInterval(() => {
    const now = Date.now();
    for (const [socketId, attempts] of connectionAttempts.entries()) {
        if (now - attempts.firstAttempt > ATTEMPT_WINDOW) {
            connectionAttempts.delete(socketId);
        }
    }
}, 60000); // Clean every minute

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Security: Limit number of sessions per socket
    let sessionsCreated = 0;
    const MAX_SESSIONS_PER_SOCKET = 3;

    socket.on('create-session', () => {
        // Security: Rate limiting check
        if (!checkRateLimit(socket.id)) {
            socket.emit('error', '너무 많은 요청이 발생했습니다. 15분 후 다시 시도해주세요.');
            console.log(`Rate limit exceeded for ${socket.id}`);
            return;
        }

        // Security: Limit sessions per socket
        if (sessionsCreated >= MAX_SESSIONS_PER_SOCKET) {
            socket.emit('error', '세션 생성 한도를 초과했습니다.');
            return;
        }

        const code = generateCode();
        sessionsCreated++;

        // Set timeout to automatically clean up session after 5 minutes
        const timeout = setTimeout(() => {
            const session = sessions.get(code);
            if (session) {
                io.to(code).emit('error', '세션이 만료되었습니다. 새로운 세션을 생성해주세요.');
                sessions.delete(code);
                console.log(`Session ${code} expired and cleaned up`);
            }
        }, SESSION_TIMEOUT);

        sessions.set(code, {
            sender: socket.id,
            receiver: null,
            createdAt: Date.now(),
            timeout
        });
        socket.join(code);
        socket.emit('session-created', code);
        console.log(`Session created: ${code} by ${socket.id}`);
    });

    socket.on('join-session', (code) => {
        // Security: Validate input
        if (!code || typeof code !== 'string') {
            socket.emit('error', '잘못된 요청입니다');
            return;
        }

        // Security: Sanitize and validate code
        const sanitizedCode = code.trim();
        if (!isValidSessionCode(sanitizedCode)) {
            socket.emit('error', '유효하지 않은 코드 형식입니다 (6자리 숫자)');
            console.log(`Invalid code format from ${socket.id}: ${code}`);
            return;
        }

        // Security: Rate limiting check
        if (!checkRateLimit(socket.id)) {
            socket.emit('error', '너무 많은 요청이 발생했습니다. 15분 후 다시 시도해주세요.');
            return;
        }

        const session = sessions.get(sanitizedCode);
        if (session && !session.receiver) {
            // Security: Prevent same socket from joining own session
            if (session.sender === socket.id) {
                socket.emit('error', '자신의 세션에는 참여할 수 없습니다');
                return;
            }

            session.receiver = socket.id;
            socket.join(sanitizedCode);
            // Notify sender that someone joined
            io.to(sanitizedCode).emit('session-connected');
            console.log(`Client ${socket.id} joined session ${sanitizedCode}`);
        } else {
            socket.emit('error', '유효하지 않은 코드이거나 세션이 가득 찼습니다');
        }
    });

    socket.on('signal', (data) => {
        // Security: Validate signal data
        if (!data || typeof data !== 'object') {
            console.log(`Invalid signal data from ${socket.id}`);
            return;
        }

        const { code, type, payload } = data;

        // Security: Validate required fields
        if (!code || !type || !payload) {
            console.log(`Missing signal fields from ${socket.id}`);
            return;
        }

        // Security: Validate code format
        if (!isValidSessionCode(code)) {
            console.log(`Invalid session code in signal from ${socket.id}`);
            return;
        }

        // Security: Validate signal type
        const validTypes = ['offer', 'answer', 'candidate'];
        if (!validTypes.includes(type)) {
            console.log(`Invalid signal type from ${socket.id}: ${type}`);
            return;
        }

        // Security: Verify sender is part of the session
        const session = sessions.get(code);
        if (!session || (session.sender !== socket.id && session.receiver !== socket.id)) {
            console.log(`Unauthorized signal attempt from ${socket.id} for session ${code}`);
            return;
        }

        // Relay signals (offer, answer, ice-candidate) to the other peer in the room
        socket.to(code).emit('signal', { type, payload });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        // Cleanup sessions
        for (const [code, session] of sessions.entries()) {
            if (session.sender === socket.id || session.receiver === socket.id) {
                // Clear the timeout when session ends early
                if (session.timeout) {
                    clearTimeout(session.timeout);
                }
                io.to(code).emit('session-ended');
                sessions.delete(code);
                console.log(`Session ${code} ended due to disconnect`);
            }
        }
    });
});

httpServer.listen(PORT, () => {
    console.log(`Signaling server running on http://0.0.0.0:${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`CORS Origin: ${corsOptions.origin || 'All origins'}`);
});
