# Product Requirements Document (PRD)
## Project Name: FreelanceX
### Full-Stack Architecture, Implementation Blueprint & Developer Specification

---

## 1. Executive Summary & Core Objective
**FreelanceX** is a secure, high-performance, full-stack freelance marketplace web application engineered to bridge the gap between employers and skilled freelancers. It features milestone-based escrow payments powered by **Paystack**, real-time peer-to-peer communication via **Socket.io**, automated transactional email notifications via **Brevo (SMTP)**, a robust dispute resolution reporting system, and a comprehensive admin moderation panel.

* **Tech Stack:**
  * **Frontend & Routing:** Next.js 14+ (App Router), TypeScript, Tailwind CSS.
  * **Backend & API:** Node.js, Express.js, Apollo Server (GraphQL API route), Socket.io.
  * **Database & ODM:** MongoDB with Mongoose.
  * **Payments:** Paystack API (Checkout initialization, webhook verification, automated bank transfers).
  * **Email Service:** Brevo SMTP (via Nodemailer) for transactional email notifications.
  * **Design System:** Clean white backgrounds (`#FFFFFF` / `#F8FAFC`), deep charcoal typography (`#0F172A`), muted slate body text (`#475569`), and professional indigo interactive elements (`#4F46E5`).

---

## 2. Environment Variables Specification (.env)
Create a `.env` file in the root directory of your project. This includes your **Brevo SMTP** configuration credentials:

```env
# ==========================================
# FREELANCEX ENVIRONMENT CONFIGURATION
# ==========================================

# Application Port & Hosts
PORT=5000
NODE_ENV=development
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000

# Database Connection
MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/freelancex?retryWrites=true&w=majority

# Authentication & Security
JWT_SECRET=super_secret_jwt_key_change_in_production_12345
JWT_EXPIRES_IN=7d

# Paystack Payment Gateway Keys
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Transactional Email Configuration (Brevo SMTP)
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_USER=your_brevo_login_or_smtp_email@domain.com
EMAIL_PASS=your_brevo_smtp_master_password_or_key
EMAIL_FROM=noreply@freelancex.com
```

---

## 3. Directory Structure & File Architecture

```text
freelancex/
├── .env                              # Environment configuration file
├── package.json
├── server.js                         # Express + Apollo + Socket.io Server Entry
├── tailwind.config.ts                # Tailwind configuration (White/Slate + Indigo)
├── models/
│   ├── User.ts                       # User Mongoose Schema
│   ├── Task.ts                       # Task & Milestone Mongoose Schema
│   ├── Message.ts                    # Real-time Chat Message Schema
│   └── Report.ts                     # Dispute & Report Schema
├── utils/
│   └── sendEmail.ts                  # Brevo SMTP Nodemailer email dispatch utility
├── graphql/
│   ├── schema.ts                     # GraphQL Type Definitions (TypeDefs)
│   └── resolvers.ts                  # Backend Query & Mutation Resolvers
└── app/                              # Next.js 14+ App Router
    ├── layout.tsx                    # Root layout with providers & Tailwind styling
    ├── page.tsx                      # Public Landing Page
    ├── login/page.tsx                # User Login Page
    ├── register/page.tsx             # User Registration with Role Selector
    ├── jobs/
    │   ├── page.tsx                  # Browse & Search Job Board
    │   └── [jobId]/page.tsx          # Job Details & Application View
    ├── dashboard/
    │   ├── employer/page.tsx         # Employer Control Center
    │   ├── freelancer/page.tsx       # Freelancer Dashboard & Active Contracts
    │   └── admin/page.tsx            # Admin Moderation & User Management Panel
    └── workspace/
        └── [taskId]/page.tsx         # Active Contract Workspace (Chat + Escrow Actions)
```

---

## 4. Backend Implementation: Database Models (Mongoose)

### A. User Model (`models/User.ts`)
```typescript
import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: 'employer' | 'freelancer' | 'admin';
  skills?: string[];
  paystackRecipientCode?: string;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['employer', 'freelancer', 'admin'], default: 'freelancer' },
  skills: [{ type: String }],
  paystackRecipientCode: { type: String },
}, { timestamps: true });

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
```

### B. Task Model (`models/Task.ts`)
```typescript
import mongoose, { Schema, Document } from 'mongoose';

export interface ITask extends Document {
  employer: mongoose.Types.ObjectId;
  freelancer?: mongoose.Types.ObjectId;
  title: string;
  description: string;
  amount: number; // Stored in NGN
  status: 'pending_payment' | 'funded' | 'in_progress' | 'submitted' | 'completed' | 'disputed';
  paystackReference?: string;
  createdAt: Date;
}

const TaskSchema = new Schema<ITask>({
  employer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  freelancer: { type: Schema.Types.ObjectId, ref: 'User' },
  title: { type: String, required: true },
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending_payment', 'funded', 'in_progress', 'submitted', 'completed', 'disputed'], 
    default: 'pending_payment' 
  },
  paystackReference: { type: String },
}, { timestamps: true });

export default mongoose.models.Task || mongoose.model<ITask>('Task', TaskSchema);
```

### C. Message Model (`models/Message.ts`)
```typescript
import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  task: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;
  content: string;
  createdAt: Date;
}

const MessageSchema = new Schema<IMessage>({
  task: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
  sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
}, { timestamps: true });

export default mongoose.models.Message || mongoose.model<IMessage>('Message', MessageSchema);
```

### D. Report Model (`models/Report.ts`)
```typescript
import mongoose, { Schema, Document } from 'mongoose';

export interface IReport extends Document {
  task: mongoose.Types.ObjectId;
  reporter: mongoose.Types.ObjectId;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: Date;
}

const ReportSchema = new Schema<IReport>({
  task: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
  reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, required: true },
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
}, { timestamps: true });

export default mongoose.models.Report || mongoose.model<IReport>('Report', ReportSchema);
```

---

## 5. Backend Utility: Brevo SMTP Email Service (`utils/sendEmail.ts`)
Configured to use Brevo's SMTP relay for sending transactional emails across the application workflow.

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST, // smtp-relay.brevo.com
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendEmail = async (to: string, subject: string, htmlContent: string) => {
  try {
    await transporter.sendMail({
      from: `"FreelanceX Notifications" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html: htmlContent,
    });
    console.log(`Brevo email successfully dispatched to ${to}`);
  } catch (error) {
    console.error(`Brevo email dispatch error for ${to}:`, error);
  }
};
```

---

## 6. Backend Server Entry & Socket.io Real-Time Setup (`server.js`)
```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully for FreelanceX'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// Socket.io Real-Time Messaging Handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join_task_room', (taskId) => {
    socket.join(taskId);
    console.log(`Socket ${socket.id} joined task room: ${taskId}`);
  });

  socket.on('send_message', async (data) => {
    try {
      const { taskId, senderId, content } = data;
      const newMessage = await Message.create({ task: taskId, sender: senderId, content });
      const populatedMessage = await Message.findById(newMessage._id).populate('sender', 'name email role');
      
      io.to(taskId).emit('receive_message', populatedMessage);
    } catch (error) {
      console.error('Socket message error:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`FreelanceX Backend Server running on port ${PORT}`);
});
```

---

## 7. GraphQL API Specification (`schema.ts`)

```graphql
type User {
  id: ID!
  name: String!
  email: String!
  role: String!
  skills: [String]
  createdAt: String!
}

type Task {
  id: ID!
  title: String!
  description: String!
  amount: Float!
  status: String!
  employer: User!
  freelancer: User
  paystackReference: String
  createdAt: String!
}

type Message {
  id: ID!
  task: ID!
  sender: User!
  content: String!
  createdAt: String!
}

type Report {
  id: ID!
  task: Task!
  reporter: User!
  reason: String!
  status: String!
  createdAt: String!
}

type Query {
  getJobs: [Task!]!
  getJob(id: ID!): Task
  getMyTasks(userId: ID!, role: String!): [Task!]!
  getMessages(taskId: ID!): [Message!]!
  getUsers: [User!]!
  getReports: [Report!]!
}

type Mutation {
  registerUser(name: String!, email: String!, password: String!, role: String!, skills: [String]): User!
  createTask(employerId: ID!, freelancerId: ID!, title: String!, description: String!, amount: Float!): Task!
  updateTaskStatus(taskId: ID!, status: String!): Task!
  fileReport(taskId: ID!, reporterId: ID!, reason: String!): Report!
  deleteUser(userId: ID!): Boolean!
}
```

---

## 8. Paystack Payment & Brevo Email Transfer Integration

### A. Initialize Payment Route (`app/api/paystack/initialize/route.ts`)
```typescript
import { NextResponse } from 'next/server';
import axios from 'axios';
import Task from '@/models/Task';

export async function POST(req: Request) {
  try {
    const { taskId } = await req.json();
    const task = await Task.findById(taskId).populate('employer');

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: task.employer.email,
        amount: task.amount * 100, // Convert to Kobo
        callback_url: `${process.env.NEXT_PUBLIC_SITE_URL}/workspace/${taskId}?verify=true`,
        metadata: { taskId: task._id.toString() },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return NextResponse.json({ authorization_url: response.data.data.authorization_url });
  } catch (error: any) {
    return NextResponse.json({ error: error.response?.data?.message || error.message }, { status: 500 });
  }
}
```

### B. Automated Payout Transfer & Brevo Email Dispatch
When the employer approves a submitted task, funds are transferred via Paystack and a notification email is sent via Brevo:
```typescript
import axios from 'axios';
import { sendEmail } from '@/utils/sendEmail';

export const releaseFundsToFreelancer = async (task: any) => {
  const amountInKobo = task.amount * 100;

  const response = await axios.post(
    'https://api.paystack.co/transfer',
    {
      source: "balance",
      amount: amountInKobo,
      recipient: task.freelancer.paystackRecipientCode,
      reason: `Payout for completed FreelanceX task: ${task.title}`
    },
    {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    }
  );

  // Notify Freelancer via Brevo Email
  await sendEmail(
    task.freelancer.email,
    'Funds Released for Completed Task!',
    `<h2>Congratulations ${task.freelancer.name}!</h2><p>Your task <strong>${task.title}</strong> has been approved by the employer, and ₦${task.amount} has been successfully transferred to your bank account via Paystack.</p>`
  );

  return response.data;
};
```

---

## 9. Frontend Styling Configuration (`tailwind.config.ts`)
Ensuring the clean white and indigo aesthetic across all pages:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#F8FAFC", // Light grayish-white background
        surface: "#FFFFFF",    // Pure white cards & containers
        heading: "#0F172A",    // Deep charcoal headings
        bodyText: "#475569",   // Muted slate gray text
        primary: {
          DEFAULT: "#4F46E5",  // Indigo-600
          hover: "#4338CA",    // Indigo-700
          light: "#EEF2FF",    // Soft indigo tint
        },
        success: "#10B981",    // Emerald green for funded/completed states
      },
    },
  },
  plugins: [],
};
export default config;
```

---

## 10. Core Frontend Pages & UI Specification

1. **Landing Page (`app/page.tsx`)**
   * *Features:* Hero section with indigo call-to-actions, platform statistics, featured job categories, and role selection links. Styled with pure white surfaces and soft slate borders.
2. **Job Board (`app/jobs/page.tsx`)**
   * *Features:* Real-time keyword search bar, budget filters, and responsive grid of task cards displaying prices in Naira.
3. **Workspace (`app/workspace/[taskId]/page.tsx`)**
   * *Features:* Split-screen layout. Left side manages task milestones and escrow status actions (`Fund Task via Paystack`, `Submit Task`, `Approve & Release Funds`, `File Dispute Report`). Right side houses the live Socket.io chat window.
4. **Admin Dashboard (`app/dashboard/admin/page.tsx`)**
   * *Features:* Secure data tables listing all platform users with a `Remove User` action button, alongside an open dispute reports review panel.