# Esteira de Demandas - Internal Operations Dashboard

## Overview

This project is an internal operations management platform designed for a Brazilian team. It centralizes various operational tools including task scheduling (Esteira de Demandas), GLPI ticket monitoring, BI registration, automation management, project management, and campaign dispatch scheduling (Disparos). The application aims to provide a unified dashboard for enhanced productivity and oversight of internal processes. It's a full-stack TypeScript application utilizing React for the frontend and Express for the backend, with a PostgreSQL database planned for future persistence.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The frontend is built with React 18 and TypeScript, employing Wouter for routing and TanStack React Query for server state management. UI components are derived from `shadcn/ui` (built on Radix UI primitives) and styled with Tailwind CSS, supporting light/dark modes. Vite handles the build process. Key views include:
- **EsteiraDemandas**: Task scheduling with recurrence, visual timers, and status badges.
- **DashboardGlpi/TimelineGlpi/KanbanGlpi**: Comprehensive GLPI ticket management with various views (dashboard, Gantt, Kanban), filtering, and time tracking.
- **BiCadastro**: Business Intelligence registration and management.
- **Automacao**: Automation workflow management.
- **Projetos**: Project management with stages, progress tracking, and status filters.
- **Disparos**: Campaign dispatch scheduling and automation using Playwright.

### Backend Architecture
The backend uses Express 5 on Node.js with TypeScript. It provides a RESTful JSON API under `/api/*`. The architecture emphasizes separation of concerns with dedicated modules for routes, data access (IStorage interface), static file serving, and Vite dev server integration. Data models for tasks, BI entities, automations, tickets, and projects are defined in a shared schema (`shared/schema.ts`).

### Data Layer
Currently utilizes in-memory storage (MemStorage) for rapid development and MVP. TypeScript types are used for schema validation.

### Development vs. Production
Development leverages Vite for HMR and Express as a proxy. Production involves pre-built static files served by Express and a single bundled server file.

### Key Features & Design Decisions
- **Role-Based Access Control**: Three-tier hierarchy (Admin, Control Desk, Analista de TI) governs access and functionality, with specific roles appearing as columns in the Esteira.
- **GLPI Integration**: Live API connection with GLPI for ticket data, featuring automatic session token renewal and configurable API credentials via the UI.
- **Recurring Tasks**: Supports daily/weekly recurrence with virtual task instances, exception tracking for deleted instances, and an override mechanism for individual edits. Timezone normalization ensures consistent date calculations.
- **Project Management**: Full CRUD for projects and their stages (etapas), including progress calculation based on stage completion.
- **RPA Module (Disparos)**: Integrates Playwright for automating tasks on external platforms (e.g., ConnectaCX), supporting scheduled and manual execution, real-time logging, and dynamic variable handling.
- **SLA Configuration**: Administrators can configure SLA hours per ticket priority, influencing due date calculations in the Timeline.
- **Kanban Ticket Timeline**: Provides a chronological view of all ticket events (follow-ups, solutions, etc.) within the Kanban card modal, with SLA summary and detailed event content.

## External Dependencies

- **GLPI**: External IT Service Management system for ticket data integration.
- **Playwright**: Browser automation library used in the RPA (Disparos) module.
- **Radix UI**: Frontend primitive components.
- **shadcn/ui**: UI component library built on Radix UI.
- **Tailwind CSS**: Utility-first CSS framework for styling.
- **TanStack React Query**: Server state management for React.
- **Wouter**: Lightweight React router.
- **Vite**: Frontend build tool.
- **esbuild**: Backend build tool.
- **Embla Carousel**: Carousel/slider component.
- **date-fns**: Date manipulation library.
- **Lucide React**: Icon library.
- **Recharts**: Data visualization library.

### Planned/Potential Integrations (Suggested by dependencies, not actively used in all modules)
- **OpenAI / Google Generative AI**: For AI capabilities.
- **Stripe**: For payment processing.
- **Nodemailer**: For email functionality.
- **Passport**: For authentication.
- **Multer**: For file uploads.
- **XLSX**: For Excel file processing.