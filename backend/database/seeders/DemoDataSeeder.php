<?php

namespace Database\Seeders;

use App\Enums\ApprovalAction;
use App\Enums\RequestStatus;
use App\Enums\RoleType;
use App\Enums\TripStatus;
use App\Enums\VehicleStatus;
use App\Models\Driver;
use App\Models\OdometerReading;
use App\Models\RequestApproval;
use App\Models\Trip;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleRequest;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

class DemoDataSeeder extends Seeder
{
    private int $reqSeq = 0;
    private int $tripSeq = 0;

    public function run(): void
    {
        $vehicles = Vehicle::orderBy('id')->get();
        $drivers = Driver::orderBy('id')->get();
        if ($vehicles->isEmpty() || $drivers->isEmpty()) {
            return;
        }

        $staff = User::whereHas('role', fn ($q) => $q->where('slug', RoleType::STAFF->value))->get();
        $approver = User::whereHas('role', fn ($q) => $q->whereIn('slug', [RoleType::APPROVER->value, RoleType::ADMINISTRATOR->value]))->first();
        $transport = User::whereHas('role', fn ($q) => $q->where('slug', RoleType::TRANSPORT_ADMIN->value))->first();

        $destinations = [
            'KNUST Hospital', 'Kumasi City Centre', 'Airport Roundabout', 'Tech Junction',
            'Ejisu District Office', 'Ashanti Regional Office', 'Data Centre - Campus', 'Central Library',
        ];
        $purposes = [
            'Equipment delivery', 'Staff transport for official duty', 'Network site inspection',
            'Document delivery', 'Vendor meeting', 'Campus support visit',
        ];

        // Track a rolling odometer per vehicle so readings stay monotonic.
        $odo = $vehicles->mapWithKeys(fn (Vehicle $v) => [$v->id => max(0, $v->current_odometer - 4000)])->all();

        // ~36 completed trips spread across the last 4 months.
        for ($i = 0; $i < 36; $i++) {
            $vehicle = $vehicles[$i % $vehicles->count()];
            $driver = $drivers[$i % $drivers->count()];
            $requester = $staff->isNotEmpty() ? $staff[$i % $staff->count()] : User::first();

            $day = Carbon::today()->subDays(random_int(3, 118))->setTime(random_int(7, 15), [0, 15, 30, 45][random_int(0, 3)]);
            $durationMin = random_int(45, 300);
            $end = (clone $day)->addMinutes($durationMin);
            $distance = random_int(8, 140);

            $request = $this->makeRequest($requester, $vehicle, $day, $end, $destinations[$i % count($destinations)], $purposes[$i % count($purposes)], RequestStatus::COMPLETED);

            if ($approver) {
                RequestApproval::create([
                    'vehicle_request_id' => $request->id,
                    'approver_id' => $approver->id,
                    'action' => ApprovalAction::APPROVED,
                    'comment' => 'Approved.',
                    'approved_at' => (clone $day)->subHours(random_int(2, 30)),
                ]);
            }

            $start = $odo[$vehicle->id];
            $finish = $start + $distance;
            $odo[$vehicle->id] = $finish;

            $trip = Trip::create([
                'trip_number' => $this->tripNumber(),
                'vehicle_request_id' => $request->id,
                'vehicle_id' => $vehicle->id,
                'driver_id' => $driver->id,
                'scheduled_start' => $day,
                'scheduled_end' => $end,
                'actual_start' => $day,
                'actual_end' => $end,
                'starting_odometer' => $start,
                'ending_odometer' => $finish,
                'distance' => $distance,
                'duration_minutes' => $durationMin,
                'status' => TripStatus::COMPLETED,
                'assigned_by' => $transport?->id,
                'started_by' => $transport?->id,
                'ended_by' => $transport?->id,
                'created_at' => (clone $day)->subDay(),
            ]);

            OdometerReading::insert([
                ['vehicle_id' => $vehicle->id, 'trip_id' => $trip->id, 'reading' => $start, 'source' => 'trip_start', 'recorded_by' => $transport?->id, 'created_at' => $day, 'updated_at' => $day],
                ['vehicle_id' => $vehicle->id, 'trip_id' => $trip->id, 'reading' => $finish, 'source' => 'trip_end', 'recorded_by' => $transport?->id, 'created_at' => $end, 'updated_at' => $end],
            ]);
        }

        // Keep each vehicle's current odometer aligned with its latest reading.
        foreach ($vehicles as $vehicle) {
            $vehicle->update(['current_odometer' => max($vehicle->current_odometer, $odo[$vehicle->id]), 'status' => VehicleStatus::AVAILABLE]);
        }

        // A few pending requests awaiting approval.
        foreach (range(1, 4) as $n) {
            $requester = $staff->isNotEmpty() ? $staff[$n % $staff->count()] : User::first();
            $day = Carbon::today()->addDays(random_int(1, 6))->setTime(random_int(8, 14), 0);
            $this->makeRequest($requester, null, $day, (clone $day)->addHours(3), $destinations[$n % count($destinations)], $purposes[$n % count($purposes)], RequestStatus::PENDING);
        }

        // One approved request scheduled for today (shows on the dashboard schedule/board).
        $requester = $staff->first() ?? User::first();
        $start = Carbon::today()->setTime(11, 0);
        $req = $this->makeRequest($requester, $vehicles->first(), $start, (clone $start)->addHours(2), 'KNUST Hospital', 'Official campus support visit', RequestStatus::SCHEDULED);
        if ($approver) {
            RequestApproval::create([
                'vehicle_request_id' => $req->id, 'approver_id' => $approver->id,
                'action' => ApprovalAction::APPROVED, 'comment' => 'Approved.', 'approved_at' => now()->subHours(4),
            ]);
        }
        Trip::create([
            'trip_number' => $this->tripNumber(),
            'vehicle_request_id' => $req->id,
            'vehicle_id' => $vehicles->first()->id,
            'driver_id' => $drivers->first()->id,
            'scheduled_start' => $start,
            'scheduled_end' => (clone $start)->addHours(2),
            'status' => TripStatus::SCHEDULED,
            'assigned_by' => $transport?->id,
        ]);
        $vehicles->first()->update(['status' => VehicleStatus::SCHEDULED]);
    }

    private function makeRequest(User $requester, ?Vehicle $vehicle, Carbon $start, Carbon $end, string $destination, string $purpose, RequestStatus $status): VehicleRequest
    {
        return VehicleRequest::create([
            'request_number' => $this->reqNumber(),
            'requester_id' => $requester->id,
            'department_id' => $requester->department_id,
            'travel_date' => $start->toDateString(),
            'requested_start_time' => $start,
            'expected_end_time' => $end,
            'destination' => $destination,
            'purpose' => $purpose,
            'passenger_count' => random_int(1, 4),
            'status' => $status,
            'created_at' => (clone $start)->subDays(random_int(1, 3)),
        ]);
    }

    private function reqNumber(): string
    {
        $this->reqSeq++;
        $base = (int) (VehicleRequest::withTrashed()->max('id') ?? 0);

        return sprintf('REQ-%05d', $base + $this->reqSeq);
    }

    private function tripNumber(): string
    {
        $this->tripSeq++;
        $base = (int) (Trip::withTrashed()->max('id') ?? 0);

        return sprintf('TRIP-%05d', $base + $this->tripSeq);
    }
}
