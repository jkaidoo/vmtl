<?php

use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DepartmentController;
use App\Http\Controllers\Api\DriverController;
use App\Http\Controllers\Api\MaintenanceRecordController;
use App\Http\Controllers\Api\MetaController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\TripController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\VehicleController;
use App\Http\Controllers\Api\VehicleRequestController;
use Illuminate\Support\Facades\Route;

// ---- Public ----------------------------------------------------------------
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

// ---- Authenticated ---------------------------------------------------------
Route::middleware(['auth:sanctum', 'throttle:120,1'])->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/me/avatar', [AuthController::class, 'updateAvatar']);
    Route::get('/meta', [MetaController::class, 'index']);
    Route::get('/dashboard', [DashboardController::class, 'index']);

    // Notifications
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::post('/notifications/{id}/read', [NotificationController::class, 'markAsRead']);
    Route::post('/notifications/read-all', [NotificationController::class, 'markAllAsRead']);

    // Web Push (VAPID) subscriptions
    Route::get('/push/vapid-public-key', [\App\Http\Controllers\Api\PushController::class, 'vapidPublicKey']);
    Route::post('/push/subscribe', [\App\Http\Controllers\Api\PushController::class, 'subscribe']);
    Route::post('/push/unsubscribe', [\App\Http\Controllers\Api\PushController::class, 'unsubscribe']);

    // Fleet availability (read-only; visible to requesters incl. Staff)
    Route::get('/availability/overview', [\App\Http\Controllers\Api\AvailabilityController::class, 'overview']);
    Route::get('/availability/check', [\App\Http\Controllers\Api\AvailabilityController::class, 'check']);

    // Vehicle requests + workflow
    Route::get('/vehicle-requests', [VehicleRequestController::class, 'index']);
    Route::post('/vehicle-requests/goodwill', [VehicleRequestController::class, 'storeGoodwill']);
    Route::post('/vehicle-requests/external', [VehicleRequestController::class, 'storeExternal']);
    Route::post('/vehicle-requests', [VehicleRequestController::class, 'store']);
    Route::get('/vehicle-requests/{vehicleRequest}', [VehicleRequestController::class, 'show']);
    Route::put('/vehicle-requests/{vehicleRequest}', [VehicleRequestController::class, 'update']);
    Route::post('/vehicle-requests/{vehicleRequest}/cancel', [VehicleRequestController::class, 'cancel']);
    Route::post('/vehicle-requests/{vehicleRequest}/approve', [VehicleRequestController::class, 'approve']);
    Route::post('/vehicle-requests/{vehicleRequest}/reject', [VehicleRequestController::class, 'reject']);
    Route::post('/vehicle-requests/{vehicleRequest}/request-changes', [VehicleRequestController::class, 'requestChanges']);
    Route::get('/vehicle-requests/{vehicleRequest}/assignment-options', [VehicleRequestController::class, 'assignmentOptions']);
    Route::post('/vehicle-requests/{vehicleRequest}/assign', [VehicleRequestController::class, 'assign']);

    // Trips
    Route::get('/trips', [TripController::class, 'index']);
    Route::get('/trips/{trip}', [TripController::class, 'show']);
    Route::post('/trips/{trip}/start', [TripController::class, 'start']);
    Route::post('/trips/{trip}/complete', [TripController::class, 'complete']);
    Route::post('/trips/{trip}/no-show', [TripController::class, 'noShow']);
    Route::post('/trips/{trip}/correct-odometer', [TripController::class, 'correctOdometer']);
    Route::post('/trips/{trip}/stops', [TripController::class, 'addStop']);
    Route::post('/trips/{trip}/stops/{stop}/decide', [TripController::class, 'decideStop']);

    // Vehicles
    Route::get('/vehicles', [VehicleController::class, 'index']);
    Route::get('/vehicles/{vehicle}', [VehicleController::class, 'show']);
    Route::get('/vehicles/{vehicle}/trips', [VehicleController::class, 'trips']);
    Route::get('/vehicles/{vehicle}/fuel', [VehicleController::class, 'fuel']);
    Route::post('/vehicles', [VehicleController::class, 'store']);
    Route::put('/vehicles/{vehicle}', [VehicleController::class, 'update']);
    Route::post('/vehicles/{vehicle}/active', [VehicleController::class, 'setActive']);
    Route::delete('/vehicles/{vehicle}', [VehicleController::class, 'destroy']);

    // Drivers
    Route::get('/drivers', [DriverController::class, 'index']);
    Route::get('/drivers/{driver}', [DriverController::class, 'show']);
    Route::get('/drivers/{driver}/trips', [DriverController::class, 'trips']);
    Route::post('/drivers', [DriverController::class, 'store']);
    Route::put('/drivers/{driver}', [DriverController::class, 'update']);
    Route::post('/drivers/{driver}/active', [DriverController::class, 'setActive']);
    Route::delete('/drivers/{driver}', [DriverController::class, 'destroy']);

    // Maintenance
    Route::get('/maintenance-records', [MaintenanceRecordController::class, 'index']);
    Route::get('/maintenance-records/{maintenanceRecord}', [MaintenanceRecordController::class, 'show']);
    Route::post('/maintenance-records', [MaintenanceRecordController::class, 'store']);
    Route::put('/maintenance-records/{maintenanceRecord}', [MaintenanceRecordController::class, 'update']);
    Route::delete('/maintenance-records/{maintenanceRecord}', [MaintenanceRecordController::class, 'destroy']);

    // Fuel purchase logging
    Route::get('/fuel-logs', [\App\Http\Controllers\Api\FuelLogController::class, 'index']);
    Route::get('/fuel-logs/{fuelLog}', [\App\Http\Controllers\Api\FuelLogController::class, 'show']);
    Route::post('/fuel-logs', [\App\Http\Controllers\Api\FuelLogController::class, 'store']);
    Route::put('/fuel-logs/{fuelLog}', [\App\Http\Controllers\Api\FuelLogController::class, 'update']);
    Route::delete('/fuel-logs/{fuelLog}', [\App\Http\Controllers\Api\FuelLogController::class, 'destroy']);

    // Analytics & reports
    Route::get('/analytics', [AnalyticsController::class, 'index']);
    Route::middleware('cap:reports.export')->group(function () {
        Route::get('/reports', [ReportController::class, 'index']);
        Route::get('/reports/export', [ReportController::class, 'export']);
    });

    // Administration (capability-gated; policies enforce record-level rules).
    Route::middleware('cap:audit.view')->get('/audit-logs', [AuditLogController::class, 'index']);

    Route::middleware('cap:settings.manage')->group(function () {
        Route::get('/settings', [\App\Http\Controllers\Api\SettingController::class, 'index']);
        Route::put('/settings', [\App\Http\Controllers\Api\SettingController::class, 'update']);
        Route::get('/settings/export', [\App\Http\Controllers\Api\SettingController::class, 'export']);
    });

    Route::middleware('cap:users.manage')->group(function () {
        Route::get('/users', [UserController::class, 'index']);
        Route::post('/users', [UserController::class, 'store']);
        Route::get('/users/{user}', [UserController::class, 'show']);
        Route::put('/users/{user}', [UserController::class, 'update']);
        Route::delete('/users/{user}', [UserController::class, 'destroy']);
    });

    Route::middleware('cap:departments.manage')->group(function () {
        Route::post('/departments', [DepartmentController::class, 'store']);
        Route::put('/departments/{department}', [DepartmentController::class, 'update']);
        Route::delete('/departments/{department}', [DepartmentController::class, 'destroy']);
    });

    // Departments listing is available to all authenticated users (for dropdowns).
    Route::get('/departments', [DepartmentController::class, 'index']);

    // Break-glass tier — the System Administrator only (spec Part II §6–§12).
    Route::middleware('super')->group(function () {
        Route::get('/rbac', [\App\Http\Controllers\Api\RbacController::class, 'index']);
        Route::put('/rbac/roles/{role}/capabilities', [\App\Http\Controllers\Api\RbacController::class, 'updateRoleCapabilities']);
        Route::get('/admin/app-health', [\App\Http\Controllers\Api\AppHealthController::class, 'index']);
        Route::get('/admin/system-controls', [\App\Http\Controllers\Api\SystemControlController::class, 'index']);
        Route::put('/admin/system-controls', [\App\Http\Controllers\Api\SystemControlController::class, 'update']);
        Route::get('/admin/directory-auth', [\App\Http\Controllers\Api\DirectoryAuthController::class, 'index']);
        Route::put('/admin/directory-auth', [\App\Http\Controllers\Api\DirectoryAuthController::class, 'update']);
        Route::get('/admin/database', [\App\Http\Controllers\Api\DatabaseConnectionController::class, 'index']);
        Route::get('/admin/documentation', [\App\Http\Controllers\Api\DocumentationController::class, 'index']);
        Route::get('/admin/documentation/{slug}', [\App\Http\Controllers\Api\DocumentationController::class, 'show']);
    });
});
