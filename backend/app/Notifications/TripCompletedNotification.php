<?php

namespace App\Notifications;

use App\Models\Trip;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class TripCompletedNotification extends Notification
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
            ->subject("Trip {$this->trip->trip_number} completed")
            ->line("Trip {$this->trip->trip_number} has been completed.")
            ->line("Distance travelled: {$this->trip->distance} km");
    }

    /** @return array<string,mixed> */
    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'trip.completed',
            'title' => 'Trip completed',
            'message' => "Trip {$this->trip->trip_number} completed ({$this->trip->distance} km)",
            'trip_id' => $this->trip->id,
            'trip_number' => $this->trip->trip_number,
        ];
    }
}
