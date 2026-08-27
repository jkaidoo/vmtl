<?php

namespace App\Policies;

use App\Models\Driver;
use App\Models\User;
use App\Support\Capabilities;

class DriverPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Driver $driver): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->hasCapability(Capabilities::DRIVERS_MANAGE);
    }

    public function update(User $user, Driver $driver): bool
    {
        return $user->hasCapability(Capabilities::DRIVERS_MANAGE) && $this->inScope($user, $driver->org_unit_id);
    }

    public function delete(User $user, Driver $driver): bool
    {
        return $user->hasCapability(Capabilities::DRIVERS_MANAGE) && $this->inScope($user, $driver->org_unit_id);
    }

    /** A driver is manageable only within the user's org-unit scope. */
    private function inScope(User $user, ?int $orgUnitId): bool
    {
        $scope = $user->visibleOrgUnitIds();

        return $scope === null || ($orgUnitId !== null && in_array($orgUnitId, $scope, true));
    }
}
