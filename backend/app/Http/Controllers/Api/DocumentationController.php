<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\File;

class DocumentationController extends Controller
{
    /** @return array<string, array{title:string, summary:string}> */
    private function registry(): array
    {
        return [
            'readme' => ['title' => 'Project README', 'summary' => 'Setup, stack, credentials and feature overview.'],
            'architecture' => ['title' => 'Technical Overview', 'summary' => 'How the backend and frontend fit together.'],
            'user-guide' => ['title' => 'User Guide', 'summary' => 'How each role uses the system.'],
            'security' => ['title' => 'Security Assessment', 'summary' => 'Authentication, RBAC and data-integrity controls.'],
        ];
    }

    public function index(): JsonResponse
    {
        $docs = collect($this->registry())->map(fn ($meta, $slug) => [
            'slug' => $slug,
            'title' => $meta['title'],
            'summary' => $meta['summary'],
        ])->values();

        return response()->json(['data' => $docs]);
    }

    public function show(string $slug): JsonResponse
    {
        $registry = $this->registry();
        abort_unless(isset($registry[$slug]), 404, 'Document not found.');

        return response()->json([
            'data' => [
                'slug' => $slug,
                'title' => $registry[$slug]['title'],
                'content' => $this->content($slug),
            ],
        ]);
    }

    private function content(string $slug): string
    {
        if ($slug === 'readme') {
            $path = base_path('../README.md');

            return File::exists($path) ? File::get($path) : '# README not found';
        }

        return match ($slug) {
            'architecture' => <<<'MD'
# Technical Overview

## Stack
- **Backend:** Laravel 13 (PHP 8.3), MySQL 8+, Sanctum token auth, RESTful API.
- **Frontend:** React + TypeScript + Vite + Tailwind (KNUST UITS design tokens).

## Layers
- **Enums** encode every status with a semantic colour (centralised styling).
- **Services** hold business logic: `AvailabilityService`, `AssignmentService`,
  `TripService`, `AnalyticsService`, `MaintenanceAlertService`, `WebPushService`.
- **Policies** + capability RBAC (`role_capabilities`) enforce authorisation
  server-side; the break-glass System Administrator holds every capability.
- **Notifications** fan out over in-app (database), email and Web Push channels.
- **PWA** layer: network-first service worker, offline shell, VAPID push.

## Request lifecycle
Request → Approval → Assignment (vehicle + driver, conflict-checked) → Trip
start → Trip completion (odometer-validated) → Reporting → Analytics, with an
append-only audit trail throughout.
MD,
            'user-guide' => <<<'MD'
# User Guide

- **Staff** submit and track vehicle requests, and cancel eligible ones.
- **Approvers** review pending requests and approve or reject (a reason is
  required to reject).
- **Transport Officers** assign a vehicle + driver to approved requests, then
  start, end or mark trips as no-show, and record maintenance.
- **Drivers** sign in to a focused view of their own assigned trips and operate
  them from a phone.
- **Administrators** manage users, departments, settings and the audit log.
- The **System Administrator** additionally holds the break-glass controls:
  App Health, RBAC, System Controls, Directory Auth, Database Connections,
  Documentation and the Codebase Guide.
MD,
            'security' => <<<'MD'
# Security Assessment

- **Authentication:** Sanctum bearer tokens; passwords hashed (bcrypt); failed
  sign-ins recorded for App Health.
- **Authorisation:** capability-based RBAC enforced on every route and via
  policies — the UI is never the boundary. One break-glass System Administrator.
- **Data integrity:** transactions + row locks prevent double-booking; odometer
  readings are validated and every correction is audited. Soft deletes retain
  history.
- **Auditability:** an append-only ledger records who did what, when, with IP.
- **Secrets:** VAPID/private keys and directory bind passwords are server-side,
  write-only, and redacted from exports.
MD,
            default => '# Not found',
        };
    }
}
