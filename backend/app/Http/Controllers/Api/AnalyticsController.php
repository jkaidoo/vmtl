<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AnalyticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AnalyticsController extends Controller
{
    public function __construct(private readonly AnalyticsService $analytics) {}

    public function index(Request $request): JsonResponse
    {
        // Analytics require the dedicated capability (spec §4.1).
        abort_unless($request->user()->hasCapability(\App\Support\Capabilities::ANALYTICS_VIEW), 403, 'You do not have access to analytics.');

        $filters = $request->only([
            'date_from', 'date_to', 'vehicle_id', 'driver_id',
            'org_unit_id', 'requester_id', 'destination', 'status',
        ]);

        return response()->json(['data' => $this->analytics->build($filters)]);
    }
}
