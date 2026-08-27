<?php

namespace App\Http\Controllers\Api;

use App\Enums\TripStatus;
use App\Exports\TripsExport;
use App\Http\Controllers\Controller;
use App\Models\FuelLog;
use App\Services\TripQueryFilter;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Maatwebsite\Excel\Facades\Excel;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    private const HEADINGS = [
        'Trip #', 'Date', 'Vehicle', 'Driver', 'Requester', 'Department',
        'Destination', 'Purpose', 'Start', 'End', 'Distance (km)', 'Status',
    ];

    private const FUEL_HEADINGS = [
        'Date', 'Vehicle', 'Driver', 'Odometer (km)', 'Since Last (km)',
        'Litres', 'Price/L (GHS)', 'Total (GHS)', 'km/L', 'Fuel Type', 'Station', 'Recorded By',
    ];

    // ---- Trips (vehicle usage) ------------------------------------------------

    /** @param array<string,mixed> $filters @return array<int, array<string,mixed>> */
    private function rows(array $filters): array
    {
        return TripQueryFilter::query($filters)
            ->with(['vehicle', 'driver', 'vehicleRequest.requester', 'vehicleRequest.orgUnit'])
            ->orderBy('scheduled_start')
            ->get()
            ->map(fn ($trip) => [
                'trip_number' => $trip->trip_number,
                'date' => $trip->scheduled_start?->toDateString(),
                'vehicle' => $trip->vehicle?->vehicle_number,
                'driver' => $trip->driver?->name,
                'requester' => $trip->vehicleRequest?->requester?->name,
                'department' => $trip->vehicleRequest?->is_goodwill ? 'Goodwill' : $trip->vehicleRequest?->orgUnit?->name,
                'destination' => $trip->vehicleRequest?->destination,
                'purpose' => $trip->vehicleRequest?->purpose,
                'start' => optional($trip->actual_start ?? $trip->scheduled_start)->format('Y-m-d H:i'),
                'end' => optional($trip->actual_end ?? $trip->scheduled_end)->format('Y-m-d H:i'),
                'distance' => $trip->distance,
                'status' => $trip->status->label(),
            ])->all();
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    private function totals(array $filters): array
    {
        $base = TripQueryFilter::query($filters);

        return [
            'trips' => (clone $base)->count(),
            'completed' => (clone $base)->where('status', TripStatus::COMPLETED->value)->count(),
            'distance' => (int) (clone $base)->where('status', TripStatus::COMPLETED->value)->sum('distance'),
        ];
    }

    // ---- Fuel -----------------------------------------------------------------

    /** @param array<string,mixed> $filters */
    private function fuelBase(array $filters): Builder
    {
        return FuelLog::query()
            ->when($filters['date_from'] ?? null, fn (Builder $q, $v) => $q->whereDate('purchase_date', '>=', $v))
            ->when($filters['date_to'] ?? null, fn (Builder $q, $v) => $q->whereDate('purchase_date', '<=', $v))
            ->when($filters['vehicle_id'] ?? null, fn (Builder $q, $v) => $q->where('vehicle_id', $v));
    }

    /** @param array<string,mixed> $filters @return array<int, array<string,mixed>> */
    private function fuelRows(array $filters): array
    {
        return $this->fuelBase($filters)
            ->with(['vehicle', 'driver', 'recordedBy'])
            ->orderBy('purchase_date')
            ->orderBy('odometer')
            ->get()
            ->map(fn (FuelLog $f) => [
                'date' => $f->purchase_date?->format('Y-m-d H:i'),
                'vehicle' => $f->vehicle?->vehicle_number,
                'driver' => $f->driver?->name ?? '—',
                'odometer' => $f->odometer,
                'distance_since_last' => $f->distanceSinceLast() ?? '—',
                'litres' => $f->litres,
                'price_per_litre' => $f->price_per_litre,
                'total_cost' => $f->total_cost,
                'km_per_litre' => $f->kmPerLitre() ?? '—',
                'fuel_type' => $f->fuel_type ?? '—',
                'station' => $f->station ?? '—',
                'recorded_by' => $f->recordedBy?->name ?? '—',
            ])->all();
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    private function fuelTotals(array $filters): array
    {
        $base = $this->fuelBase($filters);
        $measured = (clone $base)->whereNotNull('previous_odometer');
        $measuredDistance = (int) (clone $measured)->sum(\Illuminate\Support\Facades\DB::raw('odometer - previous_odometer'));
        $measuredLitres = (float) (clone $measured)->sum('litres');

        return [
            'fills' => (clone $base)->count(),
            'litres' => round((float) (clone $base)->sum('litres'), 2),
            'cost' => round((float) (clone $base)->sum('total_cost'), 2),
            'distance' => $measuredDistance,
            'km_per_litre' => $measuredLitres > 0 ? round($measuredDistance / $measuredLitres, 3) : null,
        ];
    }

    // ---- Shared ---------------------------------------------------------------

    /** @return array<string,mixed> */
    private function filters(Request $request): array
    {
        return $request->only([
            'date_from', 'date_to', 'vehicle_id', 'driver_id',
            'org_unit_id', 'requester_id', 'destination', 'status',
        ]);
    }

    private function reportType(Request $request): string
    {
        return $request->string('type')->toString() === 'fuel' ? 'fuel' : 'trips';
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $this->filters($request);
        $type = $this->reportType($request);

        if ($type === 'fuel') {
            return response()->json([
                'data' => [
                    'type' => 'fuel',
                    'rows' => $this->fuelRows($filters),
                    'totals' => $this->fuelTotals($filters),
                    'filters' => $filters,
                ],
            ]);
        }

        return response()->json([
            'data' => [
                'type' => 'trips',
                'rows' => $this->rows($filters),
                'totals' => $this->totals($filters),
                'filters' => $filters,
            ],
        ]);
    }

    public function export(Request $request): \Symfony\Component\HttpFoundation\Response
    {
        $format = $request->string('format', 'csv')->toString();
        $filters = $this->filters($request);
        $type = $this->reportType($request);
        $stamp = now()->format('Ymd_His');

        if ($type === 'fuel') {
            $rows = $this->fuelRows($filters);
            $totals = $this->fuelTotals($filters);
            $filename = "fuel-report_{$stamp}";
            $title = 'Fuel Report';
            $totalsPairs = [
                ['label' => 'Fills', 'value' => $totals['fills']],
                ['label' => 'Total litres', 'value' => number_format($totals['litres'], 2)],
                ['label' => 'Total cost', 'value' => 'GHS '.number_format($totals['cost'], 2)],
                ['label' => 'Measured distance', 'value' => number_format($totals['distance']).' km'],
                ['label' => 'Economy', 'value' => $totals['km_per_litre'] !== null ? $totals['km_per_litre'].' km/L' : '—'],
            ];

            return match ($format) {
                'xlsx', 'excel' => Excel::download(new TripsExport($rows, self::FUEL_HEADINGS, 'Fuel'), "{$filename}.xlsx"),
                'pdf' => $this->pdf($rows, self::FUEL_HEADINGS, $totalsPairs, $filters, $filename, $title),
                default => $this->csv($rows, self::FUEL_HEADINGS, $filename),
            };
        }

        $rows = $this->rows($filters);
        $totals = $this->totals($filters);
        $filename = "vehicle-usage-report_{$stamp}";
        $totalsPairs = [
            ['label' => 'Total trips', 'value' => $totals['trips']],
            ['label' => 'Completed', 'value' => $totals['completed']],
            ['label' => 'Total distance', 'value' => number_format($totals['distance']).' km'],
        ];

        return match ($format) {
            'xlsx', 'excel' => Excel::download(new TripsExport($rows, self::HEADINGS, 'Vehicle Usage'), "{$filename}.xlsx"),
            'pdf' => $this->pdf($rows, self::HEADINGS, $totalsPairs, $filters, $filename, 'Vehicle Usage Report'),
            default => $this->csv($rows, self::HEADINGS, $filename),
        };
    }

    /**
     * @param  array<int,array<string,mixed>>  $rows
     * @param  array<int,string>  $headings
     */
    private function csv(array $rows, array $headings, string $filename): StreamedResponse
    {
        return response()->streamDownload(function () use ($rows, $headings) {
            $out = fopen('php://output', 'w');
            fputcsv($out, $headings);
            foreach ($rows as $row) {
                fputcsv($out, array_values($row));
            }
            fclose($out);
        }, "{$filename}.csv", ['Content-Type' => 'text/csv']);
    }

    /**
     * @param  array<int,array<string,mixed>>  $rows
     * @param  array<int,string>  $headings
     * @param  array<int,array{label:string,value:mixed}>  $totalsPairs
     * @param  array<string,mixed>  $filters
     */
    private function pdf(array $rows, array $headings, array $totalsPairs, array $filters, string $filename, string $title): \Illuminate\Http\Response
    {
        $pdf = Pdf::loadView('reports.trips', [
            'rows' => $rows,
            'headings' => $headings,
            'totalsPairs' => $totalsPairs,
            'reportTitle' => $title,
            'filters' => $filters,
            'generatedAt' => now()->format('Y-m-d H:i'),
        ])->setPaper('a4', 'landscape');

        return $pdf->download("{$filename}.pdf");
    }
}
