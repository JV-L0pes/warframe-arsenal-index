"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DISCLAIMER_KEY } from "@/lib/inventory";

export function DisclaimerDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(DISCLAIMER_KEY)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  function accept() {
    try {
      localStorage.setItem(DISCLAIMER_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="tracking-tight">Before you continue</DialogTitle>
          <DialogDescription className="text-left leading-relaxed">
            Arsenal Index is unofficial and not affiliated with Digital Extremes.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-border bg-muted/40">
          <AlertTitle className="font-mono text-xs tracking-wide uppercase">
            Inventory fetch
          </AlertTitle>
          <AlertDescription className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p>
              The Linux export script reads Warframe process memory for a short-lived
              session token, then calls an unofficial mobile inventory API. It does
              not write to the game or automate gameplay.
            </p>
            <p>
              DE has not endorsed this. Third-party process inspection may conflict
              with account policy. Use at your own risk.
            </p>
            <p>
              Browsing the public catalog alone needs no fetch — only{" "}
              <span className="text-foreground">Import JSON</span> / the Python
              script touches live account data.
            </p>
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button type="button" className="w-full sm:w-auto" onClick={accept}>
            I understand
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
