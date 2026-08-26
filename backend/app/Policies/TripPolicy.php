<?php

namespace App\Policies;

use App\Models\Trip;
use App\Models\User;
use App\Support\Capabilities;

class TripPolicy
{
    public function viewAny(User $user): bool
    {
        return true; // scoped in controller
    }

    public function view(User $user, Trip $trip): bool
    {
        if ($user->hasCapability(Capabilities::TRIPS_OPERATE) || $user->hasCapability(Capabilities::REQUESTS_VIEW_ALL)) {
            return true;
        }

        // The requester can view their own trip; the assigned driver can view theirs.
        return $trip->vehicleRequest?->requester_id === $user->id
            || $trip->driver?->user_id === $user->id;
    }

    /** Fleet operators, or the assigned driver's own account, may operate the trip. */
    public function operate(User $user, Trip $trip): bool
    {
        return $user->hasCapability(Capabilities::TRIPS_OPERATE)
            || $trip->driver?->user_id === $user->id;
    }

    /** Odometer corrections require the dedicated capability (spec §15). */
    public function correct(User $user, Trip $trip): bool
    {
        return $user->hasCapability(Capabilities::TRIPS_CORRECT);
    }
}
