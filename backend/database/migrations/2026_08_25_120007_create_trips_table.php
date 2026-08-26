<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trips', function (Blueprint $table) {
            $table->id();
            $table->string('trip_number')->unique();     // e.g. TRIP-00031
            $table->foreignId('vehicle_request_id')->constrained('vehicle_requests')->cascadeOnDelete();
            $table->foreignId('vehicle_id')->constrained('vehicles')->restrictOnDelete();
            $table->foreignId('driver_id')->constrained('drivers')->restrictOnDelete();

            // Scheduling window (used for conflict detection).
            $table->dateTime('scheduled_start');
            $table->dateTime('scheduled_end');

            // Actuals (recorded by the system, never entered by hand).
            $table->dateTime('actual_start')->nullable();
            $table->dateTime('actual_end')->nullable();

            $table->unsignedBigInteger('starting_odometer')->nullable();
            $table->unsignedBigInteger('ending_odometer')->nullable();
            $table->unsignedBigInteger('distance')->nullable();
            $table->unsignedInteger('duration_minutes')->nullable();

            $table->string('status')->default('scheduled')->index();
            $table->text('start_notes')->nullable();
            $table->text('end_notes')->nullable();
            $table->text('admin_remarks')->nullable();

            $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('started_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('ended_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            // Speeds up overlap queries per vehicle / per driver.
            $table->index(['vehicle_id', 'scheduled_start', 'scheduled_end']);
            $table->index(['driver_id', 'scheduled_start', 'scheduled_end']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trips');
    }
};
