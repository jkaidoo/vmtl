<?php

namespace App\Support;

use App\Enums\RoleType;

/**
 * The granular capability catalog for the VMTL app (spec Part II §1/§7).
 * Capabilities are grouped for the RBAC UI and mapped to default roles.
 */
class Capabilities
{
    // Request lifecycle
    public const REQUESTS_CREATE = 'requests.create';
    public const REQUESTS_VIEW_ALL = 'requests.view_all';
    public const REQUESTS_APPROVE = 'requests.approve';
    public const REQUESTS_ASSIGN = 'requests.assign';
    public const REQUESTS_CREATE_GOODWILL = 'requests.create_goodwill';
    public const REQUESTS_CREATE_EXTERNAL = 'requests.create_external';

    // Trips
    public const TRIPS_OPERATE = 'trips.operate';
    public const TRIPS_CORRECT = 'trips.correct';

    // Fleet
    public const VEHICLES_MANAGE = 'vehicles.manage';
    public const DRIVERS_MANAGE = 'drivers.manage';
    public const MAINTENANCE_MANAGE = 'maintenance.manage';
    public const FUEL_LOG = 'fuel.log';

    // Insights
    public const ANALYTICS_VIEW = 'analytics.view';
    public const REPORTS_EXPORT = 'reports.export';

    // Administration
    public const USERS_MANAGE = 'users.manage';
    public const DEPARTMENTS_MANAGE = 'departments.manage';
    public const ROLES_MANAGE = 'roles.manage';
    public const SETTINGS_MANAGE = 'settings.manage';
    public const AUDIT_VIEW = 'audit.view';

    /** @return array<string, array{label:string, group:string, description:string}> */
    public static function catalog(): array
    {
        return [
            self::REQUESTS_CREATE => ['label' => 'Create requests', 'group' => 'Requests', 'description' => 'Submit vehicle requests.'],
            self::REQUESTS_VIEW_ALL => ['label' => 'View all requests', 'group' => 'Requests', 'description' => 'See every request, not just their own.'],
            self::REQUESTS_APPROVE => ['label' => 'Approve / reject requests', 'group' => 'Requests', 'description' => 'Decide on pending requests.'],
            self::REQUESTS_ASSIGN => ['label' => 'Assign vehicle + driver', 'group' => 'Requests', 'description' => 'Schedule an approved request.'],
            self::REQUESTS_CREATE_GOODWILL => ['label' => 'Raise goodwill requests', 'group' => 'Requests', 'description' => 'Driver/officer goodwill trip requests (need an explanation).'],
            self::REQUESTS_CREATE_EXTERNAL => ['label' => 'Log external travel', 'group' => 'Requests', 'description' => 'Vehicle requests from other university arms for extended trips.'],
            self::TRIPS_OPERATE => ['label' => 'Operate trips', 'group' => 'Trips', 'description' => 'Start / end / no-show any trip.'],
            self::TRIPS_CORRECT => ['label' => 'Correct odometer', 'group' => 'Trips', 'description' => 'Administratively correct trip readings.'],
            self::VEHICLES_MANAGE => ['label' => 'Manage vehicles', 'group' => 'Fleet', 'description' => 'Add, edit and retire vehicles.'],
            self::DRIVERS_MANAGE => ['label' => 'Manage drivers', 'group' => 'Fleet', 'description' => 'Add, edit and retire drivers.'],
            self::MAINTENANCE_MANAGE => ['label' => 'Manage maintenance', 'group' => 'Fleet', 'description' => 'Record maintenance and service.'],
            self::FUEL_LOG => ['label' => 'Log fuel purchases', 'group' => 'Fleet', 'description' => 'Record fuel purchases (odometer, litres, price).'],
            self::ANALYTICS_VIEW => ['label' => 'View analytics', 'group' => 'Insights', 'description' => 'Access fleet analytics.'],
            self::REPORTS_EXPORT => ['label' => 'Reports & exports', 'group' => 'Insights', 'description' => 'Run and export reports.'],
            self::USERS_MANAGE => ['label' => 'Manage users', 'group' => 'Administration', 'description' => 'Create and manage accounts.'],
            self::DEPARTMENTS_MANAGE => ['label' => 'Manage departments', 'group' => 'Administration', 'description' => 'Maintain organisational units.'],
            self::ROLES_MANAGE => ['label' => 'Manage roles (RBAC)', 'group' => 'Administration', 'description' => 'Edit role capabilities.'],
            self::SETTINGS_MANAGE => ['label' => 'Manage settings', 'group' => 'Administration', 'description' => 'Change system settings.'],
            self::AUDIT_VIEW => ['label' => 'View audit logs', 'group' => 'Administration', 'description' => 'Read the audit trail.'],
        ];
    }

    /** @return array<int,string> */
    public static function all(): array
    {
        return array_keys(self::catalog());
    }

    /**
     * Default capabilities granted to each role at seed time.
     *
     * @return array<string, array<int,string>>
     */
    public static function defaultsByRole(): array
    {
        return [
            RoleType::ADMINISTRATOR->value => self::all(),
            RoleType::APPROVER->value => [
                self::REQUESTS_CREATE, self::REQUESTS_VIEW_ALL, self::REQUESTS_APPROVE, self::REQUESTS_CREATE_EXTERNAL, self::ANALYTICS_VIEW,
                // Approvers may also manage the fleet register (add/remove/(de)activate).
                self::VEHICLES_MANAGE, self::DRIVERS_MANAGE, self::FUEL_LOG,
            ],
            RoleType::TRANSPORT_ADMIN->value => [
                self::REQUESTS_CREATE, self::REQUESTS_VIEW_ALL, self::REQUESTS_ASSIGN, self::REQUESTS_CREATE_GOODWILL, self::REQUESTS_CREATE_EXTERNAL,
                self::TRIPS_OPERATE, self::VEHICLES_MANAGE, self::DRIVERS_MANAGE, self::MAINTENANCE_MANAGE, self::FUEL_LOG,
                self::ANALYTICS_VIEW, self::REPORTS_EXPORT,
            ],
            RoleType::STAFF->value => [self::REQUESTS_CREATE],
            // Drivers operate their OWN trips via record ownership, may raise goodwill
            // requests, and log fuel purchased during their trips.
            RoleType::DRIVER->value => [self::REQUESTS_CREATE_GOODWILL, self::FUEL_LOG],
        ];
    }
}
