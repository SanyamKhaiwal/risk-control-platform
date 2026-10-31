package com.riskcontrol.control.events;

/** An event that can never be processed (bad JSON, missing fields, unknown schema). Not retried: sent to the DLT. */
public class InvalidEventException extends RuntimeException {

    public InvalidEventException(String message, Throwable cause) {
        super(message, cause);
    }
}
