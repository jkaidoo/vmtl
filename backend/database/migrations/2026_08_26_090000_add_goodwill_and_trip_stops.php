<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vehicle_requests', function (Blueprint $table) {
            // Goodwill requests are raised by a driver/transport officer and need
            // an explanation; they still go through approval.
            $table->boolean('is_goodwill')->default(false)->index();
            $table->text('goodwill_reason')->nullable();
        });

        // Additional destinations added mid-trip by the requester; the driver
        // must accept before they are recorded.
        Schema::create('trip_stops', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->constrained('trips')->cascadeOnDelete();
            $table->string('destination');
            $table->text('note')->nullable();
            $table->string('status')->default('pending')->index(); // pending | accepted | declined
            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('decided_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trip_stops');
        Schema::table('vehicle_requests', function (Blueprint $table) {
            $table->dropColumn(['is_goodwill', 'goodwill_reason']);
        });
    }
};
