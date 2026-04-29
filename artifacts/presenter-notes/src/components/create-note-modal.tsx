import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateNote, getListNotesQueryKey, getGetNotesStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";

interface CreateNoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreateNoteModal({ open, onOpenChange }: CreateNoteModalProps) {
  const [title, setTitle] = useState("");
  const [event, setEvent] = useState("");
  const [content, setContent] = useState("");
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const createMutation = useCreateNote({
    mutation: {
      onSuccess: (newNote) => {
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetNotesStatsQueryKey() });
        onOpenChange(false);
        setLocation(`/notes/${newNote.id}`);
      }
    }
  });

  useEffect(() => {
    if (open) {
      setTitle("");
      setEvent("");
      setContent("");
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      data: {
        title,
        event,
        content
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !createMutation.isPending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-serif">Create Manual Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input 
              id="title" 
              required 
              value={title} 
              onChange={(e) => setTitle(e.target.value)} 
              placeholder="e.g., Q3 All Hands Keynote"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event">Event Name</Label>
            <Input 
              id="event" 
              required 
              value={event} 
              onChange={(e) => setEvent(e.target.value)} 
              placeholder="e.g., Annual Summit"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content">Content (Markdown)</Label>
            <Textarea 
              id="content" 
              required 
              value={content} 
              onChange={(e) => setContent(e.target.value)} 
              className="min-h-[150px] font-mono text-sm"
              placeholder="# Introduction..."
            />
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title || !event || !content || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}