import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateNote, getGetNoteQueryKey, getListNotesQueryKey, getListNoteSummariesQueryKey, getGetNotesStatsQueryKey, getListEventsQueryKey, Note } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

interface EditNoteModalProps {
  note: Note;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EditNoteModal({ note, open, onOpenChange }: EditNoteModalProps) {
  const [title, setTitle] = useState("");
  const [event, setEvent] = useState("");
  const [content, setContent] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setTitle(note.title);
      setEvent(note.event);
      setContent(note.content);
      updateMutation.reset();
    }
  }, [open, note]);

  const updateMutation = useUpdateNote({
    mutation: {
      onSuccess: (updatedNote) => {
        queryClient.setQueryData(getGetNoteQueryKey(note.id), updatedNote);
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListNoteSummariesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetNotesStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
        onOpenChange(false);
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      id: note.id,
      data: {
        title,
        event,
        content
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !updateMutation.isPending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-serif">Edit Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input 
              id="edit-title" 
              maxLength={256}
              required 
              value={title} 
              onChange={(e) => setTitle(e.target.value)} 
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-event">Event Name</Label>
            <Input 
              id="edit-event" 
              maxLength={256}
              required 
              value={event} 
              onChange={(e) => setEvent(e.target.value)} 
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-content">Content (Markdown)</Label>
            <Textarea 
              id="edit-content" 
              required 
              value={content} 
              onChange={(e) => setContent(e.target.value)} 
              className="min-h-[250px] font-mono text-sm"
            />
          </div>
          {updateMutation.isError && <p role="alert" className="text-sm text-destructive">Could not save note. {updateMutation.error?.message}</p>}
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title || !event || !content || updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}