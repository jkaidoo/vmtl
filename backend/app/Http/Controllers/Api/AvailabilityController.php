<?php

namespace App\Http\Controllers\Api;

use App\Enums\TripStatus;
use App\Http\Controllers\Controller;
use App\Models\Driver;
use App\Models\Trip;
use App\Models\Vehicle;
use App\Services\AvailabilityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Read-only fleet availability for requesters: who is on a trip now, upcoming
 * bookings, and whether a proposed window is bookable. Available to any
 * authenticated user (including Staff, who otherwise only see their requests).
 */
class AvailabilityController extends Controller
{
    /** Statuses that occupy a vehicle/driver for scheduling. */
    private const BLOCKING = [TripStatus::SCHEDULED->value, TripStatus::IN_PROGRESS->value];

    public function __construct(private readonly AvailabilityService $availability) {}

    /** Current snapshot of every active vehicle and driver. */
    public function overview(): JsonResponse
    {
        $now = now();

        $vehicles = Vehicle::where('active', true)
            ->orderBy('vehicle_number')
            ->get()
            ->map(function (Vehicle $v) use ($now) {
                $bookings = Trip::where('vehicle_id', $v->id)
                    ->whereIn('status', self::BLOCKING)
                    ->where('scheduled_end', '>', $now)
                    ->with('vehicleRequest:id,destination')
                    ->orderBy('scheduled_start')
                    ->limit(6)
                    ->get();

                $current = $bookings->firstWhere('status', TripStatus::IN_PROGRESS);

                return [
                    'id' => $v->id,
                    'label' => $v->vehicle_number,
                    'detail' => trim("{$v->make} {$v->model}"),
                    'capacity' => $v->capacity,
                    'status' => $v->status->value,
                    'status_label' => $v->status->label(),
                    'status_color' => $v->status->color(),
                    'on_trip_now' => (bool) $current,
                    'current_trip' => $current ? [
                        'trip_number' => $current->trip_number,
                        'destination' => $current->vehicleRequest?->destination,
                        'until' => $current->scheduled_end,
                    ] : null,
                    'free_now' => $bookings->every(fn (Trip $t) => $t->scheduled_start > $now),
                    'bookings' => $this->bookingList($bookings),
                ];
            })->values();

        $drivers = Driver::where('active', true)
            ->orderBy('name')
            ->get()
            ->map(function (Driver $d) use ($now) {
                $bookings = Trip::where('driver_id', $d->id)
                    ->whereIn('status', self::BLOCKING)
                    ->where('scheduled_end', '>', $now)
                    ->with('vehicleRequest:id,destination')
                    ->orderBy('scheduled_start')
                    ->limit(6)
                    ->get();

                $current = $bookings->firstWhere('status', TripStatus::IN_PROGRESS);

                return [
                    'id' => $d->id,
                    'label' => $d->name,
                    'detail' => $d->phone,
                    'status' => $d->status->value,
                    'status_label' => $d->status->label(),
                    'status_color' => $d->status->color(),
                    'on_trip_now' => (bool) $current,
                    'current_trip' => $current ? [
                        'trip_number' => $current->trip_number,
                        'destination' => $current->vehicleRequest?->destination,
                        'until' => $current->scheduled_end,
                    ] : null,
                    'free_now' => $bookings->every(fn (Trip $t) => $t->scheduled_start > $now),
                    'bookings' => $this->bookingList($bookings),
                ];
            })->values();

        return response()->json([
            'data' => [
                'generated_at' => $now,
                'vehicles' => $vehicles,
                'drivers' => $drivers,
            ],
        ]);
    }

    /**
     * Whether a proposed window can be booked, and which existing bookings
     * overlap it (so the requester can pick a free window instead).
     */
    public function check(Request $request): JsonResponse
    {
        $data = $request->validate([
            'start' => ['required', 'date'],
            'end' => ['required', 'date', 'after:start'],
            'passengers' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $start = Carbon::parse($data['start']);
        $end = Carbon::parse($data['end']);
        $passengers = (int) ($data['passengers'] ?? 1);

        $vehicles = $this->availability->availableVehicles($start, $end, $passengers);
        $drivers = $this->availability->availableDrivers($start, $end);

        $conflicts = Trip::whereIn('status', self::BLOCKING)
            ->where('scheduled_start', '<', $end)
            ->where('scheduled_end', '>', $start)
            ->with(['vehicle:id,vehicle_number', 'driver:id,name', 'vehicleRequest:id,destination'])
            ->orderBy('scheduled_start')
            ->get()
            ->map(fn (Trip $t) => [
                'vehicle' => $t->vehicle?->vehicle_number,
                'driver' => $t->driver?->name,
                'destination' => $t->vehicleRequest?->destination,
                'start' => $t->scheduled_start,
                'end' => $t->scheduled_end,
                'status' => $t->status->value,
            ])->all();

        return response()->json([
            'data' => [
                'available_vehicles' => $vehicles->count(),
                'available_drivers' => $drivers->count(),
                'is_bookable' => $vehicles->isNotEmpty() && $drivers->isNotEmpty(),
                'conflicts' => $conflicts,
            ],
        ]);
    }

    /**
     * @param  \Illuminate\Support\Collection<int,Trip>  $bookings
     * @return array<int,array<string,mixed>>
     */
    private function bookingList($bookings): array
    {
        return $bookings->map(fn (Trip $t) => [
            'trip_number' => $t->trip_number,
            'destination' => $t->vehicleRequest?->destination,
            'start' => $t->scheduled_start,
            'end' => $t->scheduled_end,
            'status' => $t->status->value,
        ])->all();
    }
}
