<?php

namespace App\Notifications;

use App\Models\Trip;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class VehicleAssignedNotification extends Notification
{
    use Queueable;

    public function __construct(public Trip $trip) {}

    /** @return array<int,string> */
    public function via(object $notifiable): array
    {
        return ['database', 'mail', \App\Notifications\Channels\WebPushChannel::class];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("Vehicle assigned for trip {$this->trip->trip_number}")
            ->line("A vehicle and driver have been assigned.")
            ->line("Vehicle: {$this->trip->vehicle?->vehicle_number}")
            ->line("Driver: {$this->trip->driver?->name}")
            ->line("Scheduled: {$this->trip->scheduled_start?->format('Y-m-d H:i')} â€“ {$this->trip->scheduled_end?->format('H:i')}");
    }

    /** @return array<string,mixed> */
    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'vehicle.assigned',
            'title' => 'Vehicle assigned',
            'message' => "Trip {$this->trip->trip_number}: {$this->trip->vehicle?->vehicle_number} with {$this->trip->driver?->name}",
            'trip_id' => $this->trip->id,
            'trip_number' => $this->trip->trip_number,
        ];
    }
}
