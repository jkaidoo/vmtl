<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vehicle_id')->constrained('vehicles')->cascadeOnDelete();
            $table->foreignId('driver_id')->nullable()->constrained('drivers')->nullOnDelete();
            $table->foreignId('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('purchase_date');
            // Odometer at this fill-up; previous_odometer is the reading captured at
            // the previous fuel purchase (auto-filled) so distance-per-tank and fuel
            // economy can be derived across consecutive purchases.
            $table->unsignedInteger('odometer');
            $table->unsignedInteger('previous_odometer')->nullable();
            $table->decimal('litres', 8, 2);
            $table->decimal('price_per_litre', 8, 2);
            $table->decimal('total_cost', 10, 2);
            $table->string('fuel_type')->nullable();   // petrol / diesel / …
            $table->string('station')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['vehicle_id', 'purchase_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_logs');
    }
};
