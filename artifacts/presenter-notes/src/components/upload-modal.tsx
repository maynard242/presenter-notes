import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCloud, File, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useUploadNoteMarkdown, getListNotesQueryKey, getGetNotesStatsQueryKey, getListEventsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function UploadModal({ open, onOpenChange }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const queryClient = useQueryClient();

  const uploadMutation = useUploadNoteMarkdown({
    mutation: {
      onSuccess: () => {
        setIsSuccess(true);
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetNotesStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
        setTimeout(() => {
          onOpenChange(false);
          setFile(null);
          setIsSuccess(false);
        }, 1500);
      },
      onError: (err: any) => {
        setError(err.message || "Failed to upload file. Ensure it's valid markdown.");
      }
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setIsSuccess(false);
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (!selectedFile.name.toLowerCase().endsWith('.md')) {
        setError("Only markdown (.md) files are supported.");
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setError(null);
    
    try {
      const content = await file.text();
      uploadMutation.mutate({
        data: {
          filename: file.name,
          content: content
        }
      });
    } catch (err) {
      setError("Could not read file contents.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v && uploadMutation.isPending) return;
      if (!v) {
        setFile(null);
        setError(null);
        setIsSuccess(false);
      }
      onOpenChange(v);
    }}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden border-0 shadow-2xl rounded-2xl bg-card">
        <div className="p-6">
          <DialogHeader className="mb-6">
            <DialogTitle className="text-2xl font-serif">Upload Note</DialogTitle>
            <DialogDescription className="text-base">
              Select a markdown file. Frontmatter will be parsed automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {!file ? (
              <div className="border-2 border-dashed border-border rounded-xl p-8 text-center bg-background hover:bg-muted/50 transition-colors cursor-pointer relative">
                <input 
                  type="file" 
                  accept=".md"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <UploadCloud className="h-10 w-10 text-primary mx-auto mb-4 opacity-80" />
                <p className="font-medium text-foreground">Click or drag file here</p>
                <p className="text-sm text-muted-foreground mt-1">Supports .md files</p>
              </div>
            ) : (
              <div className="border border-border rounded-xl p-4 flex items-center gap-4 bg-background">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <File className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                {!uploadMutation.isPending && !isSuccess && (
                  <Button variant="ghost" size="sm" onClick={() => setFile(null)} className="shrink-0 text-muted-foreground">
                    Change
                  </Button>
                )}
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {isSuccess && (
              <Alert className="bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
                <AlertDescription>Note uploaded successfully.</AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        <div className="p-6 bg-muted/30 border-t border-border flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploadMutation.isPending}>
            Cancel
          </Button>
          <Button 
            onClick={handleUpload} 
            disabled={!file || uploadMutation.isPending || isSuccess}
            className="min-w-[100px]"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isSuccess ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              "Upload"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}