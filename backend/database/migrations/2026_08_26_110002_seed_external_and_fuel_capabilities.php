<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Grant the new capabilities to existing roles so live installs pick them up
     * without a full reseed. Values mirror Capabilities::defaultsByRole().
     *
     * @var array<string, array<int,string>>
     */
    private array $grants = [
        'transport_admin' => ['requests.create_external', 'fuel.log'],
        'approver' => ['requests.create_external', 'fuel.log'],
        'administrator' => ['requests.create_external', 'fuel.log'],
        'driver' => ['fuel.log'],
    ];

    public function up(): void
    {
        $roles = DB::table('roles')->pluck('id', 'slug');
        $now = now();

        foreach ($this->grants as $slug => $caps) {
            $roleId = $roles[$slug] ?? null;
            if (! $roleId) {
                continue;
            }
            foreach ($caps as $cap) {
                DB::table('role_capabilities')->updateOrInsert(
                    ['role_id' => $roleId, 'capability' => $cap],
                    ['updated_at' => $now, 'created_at' => $now],
                );
            }
        }
    }

    public function down(): void
    {
        $roles = DB::table('roles')->pluck('id', 'slug');

        foreach ($this->grants as $slug => $caps) {
            $roleId = $roles[$slug] ?? null;
            if (! $roleId) {
                continue;
            }
            DB::table('role_capabilities')
                ->where('role_id', $roleId)
                ->whereIn('capability', $caps)
                ->delete();
        }
    }
};
