<?php

namespace App\Policies;

use App\Models\User;
use App\Models\Vehicle;
use App\Support\Capabilities;

class VehiclePolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Vehicle $vehicle): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->hasCapability(Capabilities::VEHICLES_MANAGE);
    }

    public function update(User $user, Vehicle $vehicle): bool
    {
        return $user->hasCapability(Capabilities::VEHICLES_MANAGE) && $this->inScope($user, $vehicle->org_unit_id);
    }

    public function delete(User $user, Vehicle $vehicle): bool
    {
        return $user->hasCapability(Capabilities::VEHICLES_MANAGE) && $this->inScope($user, $vehicle->org_unit_id);
    }

    /** A vehicle is manageable only within the user's org-unit scope. */
    private function inScope(User $user, ?int $orgUnitId): bool
    {
        $scope = $user->visibleOrgUnitIds();

        return $scope === null || ($orgUnitId !== null && in_array($orgUnitId, $scope, true));
    }
}
