<?php

namespace App\Policies;

use App\Enums\RequestStatus;
use App\Models\User;
use App\Models\VehicleRequest;
use App\Support\Capabilities;

class VehicleRequestPolicy
{
    public function viewAny(User $user): bool
    {
        return true; // scope is applied in the controller
    }

    public function view(User $user, VehicleRequest $request): bool
    {
        if ($user->hasCapability(Capabilities::REQUESTS_VIEW_ALL)) {
            return true;
        }

        return $request->requester_id === $user->id;
    }

    public function create(User $user): bool
    {
        return $user->active && $user->hasCapability(Capabilities::REQUESTS_CREATE);
    }

    public function update(User $user, VehicleRequest $request): bool
    {
        // The owner may edit while pending or after changes were requested.
        return $request->requester_id === $user->id
            && $request->status->isEditableByRequester();
    }

    /** Send a request back to the requester for changes (approver or transport). */
    public function requestChanges(User $user, VehicleRequest $request): bool
    {
        return ($user->hasCapability(Capabilities::REQUESTS_APPROVE) || $user->hasCapability(Capabilities::REQUESTS_ASSIGN))
            && in_array($request->status, [RequestStatus::PENDING, RequestStatus::APPROVED], true);
    }

    public function cancel(User $user, VehicleRequest $request): bool
    {
        if (! $request->status->isCancellable()) {
            return false;
        }

        return $request->requester_id === $user->id
            || $user->hasCapability(Capabilities::REQUESTS_ASSIGN);
    }

    public function approve(User $user, VehicleRequest $request): bool
    {
        return $user->hasCapability(Capabilities::REQUESTS_APPROVE)
            && $request->status === RequestStatus::PENDING;
    }

    public function assign(User $user, VehicleRequest $request): bool
    {
        return $user->hasCapability(Capabilities::REQUESTS_ASSIGN)
            && $request->status === RequestStatus::APPROVED;
    }
}
