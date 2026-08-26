<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

class DatabaseConnectionController extends Controller
{
    public function index(): JsonResponse
    {
        $default = config('database.default');
        $conn = config("database.connections.{$default}", []);

        $version = null;
        $sizeMb = null;
        try {
            $version = DB::selectOne('select version() as v')->v ?? null;
            $row = DB::selectOne(
                'select round(sum(data_length + index_length) / 1024 / 1024, 2) as mb
                 from information_schema.tables where table_schema = ?',
                [$conn['database'] ?? null]
            );
            $sizeMb = $row->mb ?? null;
        } catch (Throwable $e) {
            // ignore — informational only
        }

        // Table row counts (a lightweight health view).
        $tables = collect(Schema::getTableListing())->map(function (string $name) {
            try {
                return ['table' => $name, 'rows' => DB::table($name)->count()];
            } catch (Throwable $e) {
                return ['table' => $name, 'rows' => null];
            }
        })->values();

        return response()->json([
            'data' => [
                'active' => [
                    'name' => $default,
                    'driver' => $conn['driver'] ?? null,
                    'host' => $conn['host'] ?? null,
                    'port' => $conn['port'] ?? null,
                    'database' => $conn['database'] ?? null,
                    'username' => $conn['username'] ?? null,
                    'password' => '[redacted]',
                    'version' => $version,
                    'size_mb' => $sizeMb,
                ],
                'profiles' => [
                    // Architecture note: dual-store profiles (spec §II-10). Only the
                    // active connection is authoritative; secrets are encrypted at rest.
                    ['name' => $default, 'driver' => $conn['driver'] ?? 'mysql', 'active' => true],
                ],
                'tables' => $tables,
                'migration_note' => 'Schema is managed by Laravel migrations (idempotent, run on deploy). A staged SQLite→PostgreSQL cutover is not enabled for this app.',
            ],
        ]);
    }
}
